// ==UserScript==
// @name         Bulk Downloader for Correicoes
// @namespace    company.tools
// @version      1.0
// @description  Auto-download files from jqGrid JSON
// @match        https://aplicacao.mpmg.mp.br/correicaopromotores/api/controller/correicao/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {

    'use strict';

    console.log('[Downloader] Step 1 loaded');

    // CONFIG

    const REQUEST_URL_FRAGMENT =
        '/correicaopromotores/api/service/correicaoparecer/buscar/';

    const DOWNLOAD_BASE =
        '/correicaopromotores/api/service/correicaoparecer/download/';

    const DOWNLOAD_DELAY_MIN = 3000;
    const DOWNLOAD_DELAY_MAX = 5000;

    const CONFIG = {
        BUTTON_ID: 'bulkDownloadBtn',
        CONTAINER_SELECTOR: '.form-action .btn-group',
        CHECK_INTERVAL: 500
    };

    // RUNTIME STATE

    const RUNTIME = {

		session: {
			active: false,
			startedAt: null,
			finishedAt: null,
			cancelRequested: false
		},

		stats: {
			total: 0,
			completed: 0,
			failed: 0,
			skipped: 0
		},

		current: {
			index: 0,
			row: null,
			filename: null,
			status: 'idle' // idle, preparing, downloading, completed, failed, skipped, cancelled
		}
	}

    // STATE

    let uiReady = false;
    let capturedRows = [];
    let isHooked = false;

	// STATE HELPER FUNCTIONS

	function isDownloadActive() {
		return RUNTIME.session.active;
	}

	function startSession(totalFiles) {

		RUNTIME.session.active = true;
		RUNTIME.session.startedAt = Date.now();
		RUNTIME.stats.total = totalFiles;
	}

	function setButtonLoading(button, loading) {

		button.disabled = loading;

		button.innerText = loading
			? 'Downloading...'
			: 'Download All Files';
	}

	function finishSession() {

		RUNTIME.session.active = false;
		RUNTIME.session.finishedAt = Date.now();
	}

	function updateCurrentDownload(index, row, filename) {

		RUNTIME.current.index = index;
		RUNTIME.current.row = row;
		RUNTIME.current.filename = filename;
	}

	function markDownloadCompleted() {
		RUNTIME.stats.completed++;
	}

	function markDownloadFailed() {
		RUNTIME.stats.failed++;
	}

    // DATA LAYER

    function hasData() {
        return Array.isArray(capturedRows) && capturedRows.length > 0;
    }

    function getData() {
        return capturedRows || [];
    }

    function getDataCount() {
        return capturedRows?.length || 0;
    }

    // DOWNLOAD ENGINE

    function buildFilename(index, row, pad_length) {

        const prefix =
              String(index + 1).padStart(pad_length, '0') + '. ';

        return prefix + sanitizeFilename(row.nome);
    }

    async function downloadFile(id, filename) {

        const response = await fetch(DOWNLOAD_BASE + id, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();

        await saveBlob(blob, filename);
    }

    async function startDownloadPipeline() {

		if (isDownloadActive()) {
			alert('A download session is already running.');
			return;
		}

        const rows = getData();

        if (!rows.length) {
            alert('No data available');
            return;
        }

		startSession(rows.length);

        console.log('[Downloader] starting pipeline:', rows.length);

        try {

            const row_index_digits = Math.floor(Math.log10(rows.length)) + 1

            for (let i = 0; i < rows.length; i++) {

                const row = rows[i];

                if (!row?.id || !row?.nome) {
                    console.warn('[Downloader] invalid row:', row);
                    continue;
                }

                const filename = buildFilename(i, row, row_index_digits);

				updateCurrentDownload(i, row, filename);

                console.log('[Downloader] downloading:', filename);

                await downloadFile(row.id, filename);

				markDownloadCompleted();

                await sleep(randomDelay(3000, 5000));
            }

            alert('Downloads complete');

        } catch (err) {
            console.error('[Downloader] pipeline error:', err);
            alert('Download failed. Check console.');
        } finally {
			finishSession();
		}
    }

    // SAVE FILE

    async function saveBlob(blob, filename) {

        return new Promise(resolve => {

            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');

            a.href = blobUrl;
            a.download = filename;
            a.style.display = 'none';

            document.body.appendChild(a);

            a.click();

            setTimeout(() => {

                URL.revokeObjectURL(blobUrl);
                a.remove();
                resolve();

            }, 3000);
        });
    }

    // HELPERS

    function randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function sleep(ms) {

        return new Promise(
            resolve => {
                setTimeout(resolve, ms);
            });
    }

    function sanitizeFilename(name) {
        return name.replace(/[\\/:*?"<>|]/g, '_');
    }

    // NETWORK CAPTURE MODULE

    function hookXHR() {

        if (isHooked) return;
        isHooked = true;

        console.log('[Downloader] XHR hook initialized');

        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url) {
            this._url = url;
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function () {

            //console.log('[Downloader] XHR send detected:', this._url);

            this.addEventListener('load', function () {

                //console.log('[Downloader] XHR load fired:', this._url);

                try {

                    const json = JSON.parse(this.responseText);

                    const isTarget =
                          json &&
                          Array.isArray(json.rows) &&
                          json.rows.length > 0

                    if (!isTarget) {
                        //console.warn('[Downloader] ', this._url,' is not target');
                        return;
                    }

                    const url = this._url || '';

                    if (!url.includes(REQUEST_URL_FRAGMENT)){
                        //console.warn('[Downloader] ', this._url,' does not match');
                        return
                    };

                    capturedRows = json.rows;

                    console.log(
                        '[Downloader] TARGET MATCH:',
                        url,
                        'rows:',
                        capturedRows.length
                    );

                } catch (err) {
                    console.error('[Downloader] XHR error:', err);
                }

            });

            return originalSend.apply(this, arguments);
        };
    }

    // INIT

    init();

    function init() {

        hookXHR();

        waitForUI()
            .then(injectButton)
            .catch(err => {
                console.error('[Downloader] UI init failed:', err);
        });
    }

    // WAIT FOR UI

    function waitForUI() {

        return new Promise((resolve) => {

            const interval = setInterval(() => {

                const container =
                    document.querySelector(CONFIG.CONTAINER_SELECTOR);

                console.log('[Downloader] waiting UI...', container);

                if (!container) return;

                clearInterval(interval);

                uiReady = true;

                resolve(container);

            }, CONFIG.CHECK_INTERVAL);
        });
    }

    // INJECT BUTTON

    function injectButton(container) {

        if (document.querySelector('#' + CONFIG.BUTTON_ID)) {
            console.log('[Downloader] button already exists');
            return;
        }

        const button = createButton();

        container.appendChild(button);

        console.log('[Downloader] button injected');

        bindButton(button);
    }

    // CREATE BUTTON (PURE)

    function createButton() {

        const btn = document.createElement('button');

        btn.id = CONFIG.BUTTON_ID;
        btn.type = 'button';
        btn.innerText = 'Download All Files';

        btn.className = 'btn btn-success';

        btn.style.marginLeft = '10px';

        return btn;
    }

    // EVENT BINDING

    function bindButton(button) {
        button.addEventListener('click', async () => {

			if (isDownloadActive()) {
				return;
			}

			setButtonLoading(button, true);

			try {
				await startDownloadPipeline();
			}
			finally {
				setButtonLoading(button, false);
			}
		});
    }

})();
