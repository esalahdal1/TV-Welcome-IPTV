(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;

    function registerOfflineWorker() {
        if (global.location.protocol !== 'https:' && global.location.hostname !== '127.0.0.1' && global.location.hostname !== 'localhost') {
            return;
        }
        if (global.navigator && 'serviceWorker' in global.navigator) {
            global.navigator.serviceWorker.register('sw.js').catch(function () {});
        }
    }

    function boot() {
        registerOfflineWorker();

        var stage = global.document.getElementById('stage');
        var staffRoot = global.document.getElementById('staffRoot');
        var mobileRoot = global.document.getElementById('mobilePortalRoot');

        if (cfg.IS_ADMIN || cfg.IS_RECEPTION) {
            if (stage) stage.style.display = 'none';
            if (staffRoot) staffRoot.style.display = 'block';
            TVApp.staff.init(cfg.IS_RECEPTION ? 'requests' : 'rooms');
            return;
        }

        if (cfg.IS_GUEST_MOBILE) {
            if (stage) stage.style.display = 'none';
            if (mobileRoot) mobileRoot.style.display = 'block';
            TVApp.mobilePortal.init();
            return;
        }

        if (cfg.IS_LOBBY) {
            TVApp.lobby.init();
            return;
        }

        TVApp.portal.init();
    }

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window);
