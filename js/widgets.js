(function (global) {
    'use strict';

    var TVApp = global.TVApp = global.TVApp || {};
    var cfg = TVApp.config;
    var i18n = TVApp.i18n;
    var escapeHtml = TVApp.utils.escapeHtml;

    var lastWeatherCode = null;
    var lastWeatherTemp = null;
    var cachedPrayers = null;

    function createParticles() {
        var container = global.document.getElementById('particles');
        if (!container) return;
        container.innerHTML = '';
        for (var i = 0; i < 24; i++) {
            var p = global.document.createElement('div');
            p.className = 'particle';
            var size = Math.random() * 7 + 6;
            var duration = Math.random() * 12 + 12;
            var opacity = Math.random() * 0.36 + 0.12;
            p.style.setProperty('--s', size + 'px');
            p.style.setProperty('--x', Math.random() * 100 + 'vw');
            p.style.setProperty('--y', Math.random() * 100 + 'vh');
            p.style.setProperty('--d', duration + 's');
            p.style.setProperty('--o', String(opacity));
            container.appendChild(p);
        }
    }

    function getRiyadhHour() {
        try {
            var h = new Intl.DateTimeFormat('en-US', {
                hour: 'numeric',
                hour12: false,
                timeZone: 'Asia/Riyadh'
            }).format(new Date());
            return parseInt(h, 10) || 12;
        } catch (e) {
            return new Date().getHours();
        }
    }

    function updateClockAndGreeting() {
        var now = new Date();
        var lang = i18n.getLang();
        var locale = lang === 'en' ? 'en-US' : 'ar-SA';
        var timeEl = global.document.getElementById('time');
        var dateEl = global.document.getElementById('date');
        var greetEl = global.document.getElementById('welcomeMsg');

        var timeText = '';
        var gregDate = '';
        var hijriDate = '';

        try {
            timeText = new Intl.DateTimeFormat(locale, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: 'Asia/Riyadh'
            }).format(now);

            gregDate = new Intl.DateTimeFormat(locale + '-u-ca-gregory', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Riyadh'
            }).format(now);

            hijriDate = new Intl.DateTimeFormat(locale + '-u-ca-islamic-umalqura', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
                timeZone: 'Asia/Riyadh'
            }).format(now);
        } catch (e) {
            timeText = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            gregDate = now.toDateString();
        }

        if (timeEl) timeEl.innerText = timeText;
        if (dateEl) {
            var suffix = lang === 'en' ? ' AH' : ' هـ';
            dateEl.innerHTML = hijriDate
                ? escapeHtml(gregDate) + '<br>' + escapeHtml(hijriDate + suffix)
                : escapeHtml(gregDate);
        }

        if (greetEl) {
            var d = i18n.dict();
            var hr = getRiyadhHour();
            if (hr >= 5 && hr < 12) greetEl.innerText = d.greetingMorning;
            else if (hr >= 12 && hr < 17) greetEl.innerText = d.greetingAfternoon;
            else greetEl.innerText = d.greetingEvening;
        }
    }

    function renderWeather() {
        var tempEl = global.document.getElementById('temp');
        var descEl = global.document.getElementById('weatherDesc');
        var icon = global.document.getElementById('weather-icon');

        if (tempEl) {
            tempEl.innerText = lastWeatherTemp == null ? '—' : Math.round(lastWeatherTemp) + '°C';
        }
        if (descEl) {
            descEl.innerText = lastWeatherCode == null ? '—' : i18n.weatherDesc(lastWeatherCode);
        }
        if (icon && lastWeatherCode != null) {
            var n = Number(lastWeatherCode);
            if (n === 0) icon.className = 'fas fa-sun';
            else if (n === 1 || n === 2) icon.className = 'fas fa-cloud-sun';
            else if (n === 3) icon.className = 'fas fa-cloud';
            else if (n === 45 || n === 48) icon.className = 'fas fa-smog';
            else if (n >= 51 && n <= 67) icon.className = 'fas fa-cloud-showers-heavy';
            else if (n >= 71 && n <= 77) icon.className = 'fas fa-snowflake';
            else if (n >= 80 && n <= 86) icon.className = 'fas fa-cloud-rain';
            else if (n >= 95) icon.className = 'fas fa-bolt';
            else icon.className = 'fas fa-cloud-sun';
        }
    }

    async function fetchWeather() {
        var h = cfg.HOTEL_DEFAULTS;
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + h.lat + '&longitude=' + h.lon + '&current=temperature_2m,weather_code&timezone=Asia%2FRiyadh';
        try {
            var resp = await global.fetch(url);
            var data = await resp.json();
            if (data && data.current) {
                lastWeatherTemp = data.current.temperature_2m;
                lastWeatherCode = data.current.weather_code;
                try {
                    global.localStorage.setItem('LAST_WEATHER_V2', JSON.stringify({
                        temp: lastWeatherTemp,
                        code: lastWeatherCode,
                        ts: Date.now()
                    }));
                } catch (e) {}
            }
        } catch (err) {
            try {
                var cached = JSON.parse(global.localStorage.getItem('LAST_WEATHER_V2') || 'null');
                if (cached && cached.temp != null) {
                    lastWeatherTemp = cached.temp;
                    lastWeatherCode = cached.code;
                }
            } catch (e2) {}
        }
        renderWeather();
    }

    function getRiyadhMinutesNow() {
        try {
            var parts = new Intl.DateTimeFormat('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
                timeZone: 'Asia/Riyadh'
            }).format(new Date()).split(':');
            return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
        } catch (e) {
            var d = new Date();
            return d.getHours() * 60 + d.getMinutes();
        }
    }

    function parsePrayerMinutes(hhmm) {
        var clean = String(hhmm || '').split(' ')[0];
        var parts = clean.split(':');
        if (parts.length < 2) return null;
        return (parseInt(parts[0], 10) * 60) + parseInt(parts[1], 10);
    }

    function formatHhMm12(hhmm) {
        var clean = String(hhmm || '').split(' ')[0];
        var parts = clean.split(':');
        if (parts.length < 2) return '—';
        var h = parseInt(parts[0], 10);
        var m = parts[1];
        if (isNaN(h)) return '—';
        var isPm = h >= 12;
        var h12 = h % 12 || 12;
        return h12 + ':' + m + (isPm ? (i18n.getLang() === 'en' ? ' PM' : ' م') : (i18n.getLang() === 'en' ? ' AM' : ' ص'));
    }

    function formatCountdown(diffMin) {
        var hrs = Math.floor(diffMin / 60);
        var mins = diffMin % 60;
        if (i18n.getLang() === 'en') {
            return hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
        }
        return hrs > 0 ? hrs + ' س ' + mins + ' د' : mins + ' د';
    }

    function renderPrayers() {
        var grid = global.document.getElementById('prayerGrid');
        var nextBadge = global.document.getElementById('prayerNext');
        var titleEl = global.document.getElementById('prayerTitleText');
        if (!grid) return;

        var d = i18n.dict();
        if (titleEl) titleEl.innerText = d.prayerHeader;

        var keys = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
        if (!cachedPrayers) {
            grid.innerHTML = keys.map(function (k) {
                return '<div class="prayer-item"><div class="prayer-name">' + escapeHtml(d.prayers[k]) + '</div><div class="prayer-time">—</div></div>';
            }).join('');
            if (nextBadge) nextBadge.style.display = 'none';
            return;
        }

        var nowMin = getRiyadhMinutesNow();
        var nextKey = null;
        var minDiff = 9999;

        for (var i = 0; i < keys.length; i++) {
            var pm = parsePrayerMinutes(cachedPrayers[keys[i]]);
            if (pm != null && pm > nowMin) {
                nextKey = keys[i];
                minDiff = pm - nowMin;
                break;
            }
        }
        if (!nextKey) {
            var fajrMin = parsePrayerMinutes(cachedPrayers.Fajr);
            nextKey = 'Fajr';
            if (fajrMin != null) minDiff = (1440 - nowMin) + fajrMin;
        }

        if (nextBadge && nextKey) {
            nextBadge.style.display = 'inline-block';
            nextBadge.innerText = d.prayerNextPrefix + ' ' + d.prayers[nextKey] + ' (' + formatCountdown(minDiff) + ')';
        }

        grid.innerHTML = keys.map(function (k) {
            var cls = k === nextKey ? 'prayer-item is-next' : 'prayer-item';
            return '<div class="' + cls + '">' +
                '<div class="prayer-name">' + escapeHtml(d.prayers[k]) + '</div>' +
                '<div class="prayer-time">' + escapeHtml(formatHhMm12(cachedPrayers[k])) + '</div>' +
                '</div>';
        }).join('');
    }

    async function fetchPrayers() {
        var todayKey = '';
        try {
            todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
        } catch (e) {
            todayKey = new Date().toISOString().slice(0, 10);
        }

        try {
            var stored = JSON.parse(global.localStorage.getItem('PRAYER_CACHE') || 'null');
            if (stored && stored.date === todayKey && stored.timings) {
                cachedPrayers = stored.timings;
                renderPrayers();
                return;
            }
        } catch (e) {}

        var h = cfg.HOTEL_DEFAULTS;
        var url = 'https://api.aladhan.com/v1/timingsByCity?city=' + encodeURIComponent(h.city) + '&country=' + encodeURIComponent(h.country) + '&method=4';
        try {
            var resp = await global.fetch(url);
            var json = await resp.json();
            if (json && json.data && json.data.timings) {
                cachedPrayers = json.data.timings;
                try {
                    global.localStorage.setItem('PRAYER_CACHE', JSON.stringify({
                        date: todayKey,
                        timings: cachedPrayers
                    }));
                } catch (e) {}
            }
        } catch (err) {
            try {
                var fallback = JSON.parse(global.localStorage.getItem('PRAYER_CACHE') || 'null');
                if (fallback && fallback.timings) cachedPrayers = fallback.timings;
            } catch (e2) {}
        }
        renderPrayers();
    }

    TVApp.widgets = {
        init: function () {
            createParticles();
            updateClockAndGreeting();
            renderPrayers();
            fetchWeather();
            fetchPrayers();

            global.setInterval(function () {
                updateClockAndGreeting();
                renderPrayers();
            }, 15000);
            global.setInterval(fetchWeather, 1800000);
            global.setInterval(fetchPrayers, 3600000);
        },
        refreshLanguage: function () {
            updateClockAndGreeting();
            renderWeather();
            renderPrayers();
        }
    };
})(window);

