// Inicijalizacija mape
var map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 20,
    scrollWheelZoom: false,
    dragging: true,
    zoomControl: false
});

// Custom wheel zoom around cursor
map.getContainer().addEventListener('wheel', function (e) {
    e.preventDefault();
    var change = e.deltaY > 0 ? -1 : 1;
    var current = map.getZoom();
    var target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), current + change));
    if (target !== current) {
        var point = map.mouseEventToContainerPoint(e);
        var latlng = map.containerPointToLatLng(point);
        map.setZoomAround(latlng, target);
    }
});

var imageUrl = 'garden.svg';
var imageBounds = [[0, 0], [714, 1000]];
L.imageOverlay(imageUrl, imageBounds).addTo(map);
map.fitBounds(imageBounds);
map.setZoom(0);
map.setView([357, 500], 0);

var USER_STORAGE_KEY = 'horvati_inventory_user_items_v1';
var NOTE_STORAGE_KEY = 'horvati_inventory_note_overrides_v1';
var DETAILS_STORAGE_KEY = 'horvati_inventory_plant_details_v1';
var POSITION_STORAGE_KEY = 'horvati_inventory_position_overrides_v1';

var baseItems = [];
var userItems = [];
var noteOverrides = {};
var plantDetails = {};
var positionOverrides = {};
var userMarkersById = {};
var allItemsById = {};
var allMarkersById = {};
var baseOriginalNotesById = {};
var baseOriginalPositionsById = {};
var baseVisibleVineIds = {};
var dragEnabled = false;
var placementEnabled = false;
var waterFilterEnabled = false;
var selectedPlant = null;

// ---------------------------------------------------------------------------
// Spremanje podataka: na Vercelu ide na server (api/state, Postgres),
// inače (npr. GitHub Pages ili lokalno) ostaje u localStorage kao prije.
// ---------------------------------------------------------------------------
var STATE_API_URL = 'api/state';
var storageMode = 'local'; // 'server' kad je API dostupan
var syncSnapshot = { user: {}, note: {}, details: {}, position: {}, deleted: {}, task: {} };
var taskDone = {}; // obavljeni zadaci iz rasporeda: 'godina:zadatak' -> { done, at }
var deletedIds = {}; // izbrisana originalna stabla: id -> { deletedAt, name, treeType }
var pendingChanges = {};
var syncInFlight = false;
var syncRetryTimer = null;
var syncFlushTimer = null;
var isAdminUser = false;
var AUTH_API_URL = 'api/auth';

// Uređivati može samo admin (na staroj verziji bez servera svi, kao prije).
function canEdit() {
    return storageMode === 'local' || isAdminUser;
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    return '{' + Object.keys(value).sort().filter(function (key) {
        return value[key] !== undefined;
    }).map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
}

function userItemsAsMap(items) {
    var result = {};
    (items || []).forEach(function (item) {
        if (item && item.id) result[item.id] = item;
    });
    return result;
}

function buildSnapshotFromMap(objectMap) {
    var snap = {};
    Object.keys(objectMap || {}).forEach(function (id) {
        snap[id] = stableStringify(objectMap[id]);
    });
    return snap;
}

function setSyncStatus(state, message) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    el.dataset.state = state;
    if (message) {
        el.textContent = message;
    } else if (state === 'saving') {
        el.textContent = '☁️ Spremanje...';
    } else if (state === 'error') {
        el.textContent = '⚠️ Spremanje nije uspjelo, pokušavam ponovno...';
    } else if (state === 'ok') {
        el.textContent = '☁️ Sve spremljeno na server.';
    } else {
        el.textContent = 'Sve novo ostaje spremljeno nakon refresha.';
    }
}

function queueServerSync(kind, currentMap) {
    if (!isAdminUser) return;
    var snap = syncSnapshot[kind];
    var changed = false;

    Object.keys(currentMap).forEach(function (id) {
        var serialized = stableStringify(currentMap[id]);
        if (snap[id] === serialized) return;
        snap[id] = serialized;
        var key = kind + '|' + id;
        delete pendingChanges[key];
        pendingChanges[key] = { kind: kind, id: id, value: JSON.parse(serialized) };
        changed = true;
    });

    Object.keys(snap).forEach(function (id) {
        if (Object.prototype.hasOwnProperty.call(currentMap, id)) return;
        delete snap[id];
        var key = kind + '|' + id;
        delete pendingChanges[key];
        pendingChanges[key] = { kind: kind, id: id, value: null };
        changed = true;
    });

    if (changed) scheduleServerFlush();
}

function scheduleServerFlush() {
    if (syncFlushTimer) clearTimeout(syncFlushTimer);
    setSyncStatus('saving');
    syncFlushTimer = setTimeout(function () {
        syncFlushTimer = null;
        flushServerSync(false);
    }, 250);
}

function hasUnsavedChanges() {
    return storageMode === 'server' && (syncInFlight || Object.keys(pendingChanges).length > 0);
}

function flushServerSync(useKeepalive) {
    if (storageMode !== 'server' || syncInFlight) return;
    var keys = Object.keys(pendingChanges);
    if (keys.length === 0) {
        setSyncStatus('ok');
        return;
    }

    var sent = {};
    var changes = keys.map(function (key) {
        sent[key] = pendingChanges[key];
        return pendingChanges[key];
    });

    syncInFlight = true;
    setSyncStatus('saving');

    fetch(STATE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', changes: changes }),
        keepalive: !!useKeepalive
    })
        .then(function (response) {
            if (response.status === 401) {
                window.location.reload();
                throw new Error('Nisi prijavljen');
            }
            if (response.status === 403) {
                var forbidden = new Error('Nisi prijavljen kao admin');
                forbidden.forbidden = true;
                throw forbidden;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function () {
            keys.forEach(function (key) {
                if (pendingChanges[key] === sent[key]) delete pendingChanges[key];
            });
            syncInFlight = false;
            if (Object.keys(pendingChanges).length > 0) {
                flushServerSync(false);
            } else {
                setSyncStatus('ok');
            }
        })
        .catch(function (error) {
            console.error('Spremanje na server nije uspjelo:', error);
            syncInFlight = false;
            if (error && error.forbidden) {
                pendingChanges = {};
                setSyncStatus('error', '⚠️ Izmjene nisu spremljene: nisi prijavljen kao admin.');
                setAdminMode(false);
                alert('Izmjene nisu spremljene jer više nisi prijavljen kao admin. Prijavi se ponovno i osvježi stranicu.');
                return;
            }
            setSyncStatus('error');
            if (syncRetryTimer) clearTimeout(syncRetryTimer);
            syncRetryTimer = setTimeout(function () {
                syncRetryTimer = null;
                flushServerSync(false);
            }, 5000);
        });
}

window.addEventListener('beforeunload', function (e) {
    if (!hasUnsavedChanges()) return;
    flushServerSync(true);
    e.preventDefault();
    e.returnValue = '';
});

document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && storageMode === 'server') {
        flushServerSync(true);
    }
});

// Vraća stanje sa servera, ili null ako server ne postoji (stari način rada).
var isOfflineData = false; // podaci su iz spremnika na uređaju (nema interneta)

function fetchServerState() {
    return fetch(STATE_API_URL, { cache: 'no-store' })
        .catch(function () {
            // Bez interneta i bez spremljenih podataka: ne prelazi na stari lokalni način rada.
            if (navigator.onLine === false) throw new Error('Nema interneta, a podaci još nisu spremljeni na ovaj uređaj.');
            return null;
        })
        .then(function (response) {
            if (!response) return null;
            if (response.headers.get('X-Offline-Cache')) isOfflineData = true;
            if (response.status === 401) {
                window.location.reload();
                throw new Error('Nisi prijavljen');
            }
            var contentType = response.headers.get('content-type') || '';
            if (response.status === 404 || contentType.indexOf('application/json') === -1) return null;
            return response.json().then(function (body) {
                if (!response.ok) throw new Error(body && body.error ? body.error : 'HTTP ' + response.status);
                return body;
            });
        });
}

function fetchJsonFile(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
        if (!response.ok) throw new Error('Nema ' + url);
        return response.json();
    });
}

// Prvo pokretanje: kopiraj data/stabla.json i data/loza.json u bazu.
function ensureServerSeeded(state) {
    if (state.seeded) return Promise.resolve(state);
    if (!isAdminUser) {
        return Promise.reject(new Error('Baza je prazna. Prijavi se kao admin i osvježi stranicu da se podaci kopiraju.'));
    }

    setSyncStatus('saving', '☁️ Prvo pokretanje: kopiram podatke u bazu...');
    return fetchJsonFile('data/stabla.json')
        .then(function (stablaData) {
            return fetchJsonFile('data/loza.json')
                .catch(function () { return { items: [] }; })
                .then(function (lozaData) {
                    return fetch(STATE_API_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'seed', stabla: stablaData, loza: lozaData })
                    });
                });
        })
        .then(function (response) {
            if (!response.ok) throw new Error('Kopiranje podataka u bazu nije uspjelo (HTTP ' + response.status + ')');
            return fetchServerState();
        })
        .then(function (freshState) {
            if (!freshState || !freshState.seeded) throw new Error('Baza je i dalje prazna nakon kopiranja.');
            return freshState;
        });
}

function asPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

var serverUserItemsRaw = null;

function applyServerState(state) {
    noteOverrides = asPlainObject(state.noteOverrides);
    plantDetails = asPlainObject(state.plantDetails);
    positionOverrides = asPlainObject(state.positionOverrides);
    deletedIds = asPlainObject(state.deletedIds);
    taskDone = asPlainObject(state.taskDone);
    serverUserItemsRaw = Array.isArray(state.userItems) ? state.userItems : [];

    syncSnapshot = {
        user: buildSnapshotFromMap(userItemsAsMap(serverUserItemsRaw)),
        note: buildSnapshotFromMap(noteOverrides),
        details: buildSnapshotFromMap(plantDetails),
        position: buildSnapshotFromMap(positionOverrides),
        deleted: buildSnapshotFromMap(deletedIds),
        task: buildSnapshotFromMap(taskDone)
    };
    pendingChanges = {};
}

// Backup svih izmjena (nova stabla, napomene, status, pozicije) u jedan JSON.
function downloadChangesBackup() {
    var payload = {
        format: 'horvati-izmjene',
        verzija: 1,
        izvor: storageMode,
        exportedAt: new Date().toISOString(),
        userItems: userItems,
        noteOverrides: noteOverrides,
        plantDetails: plantDetails,
        positionOverrides: positionOverrides
    };

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var now = new Date();
    var datePart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'horvati-izmjene-' + datePart + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Uvoz backupa (npr. izmjena iz preglednika sa stare GitHub Pages stranice) na server.
function importChangesBackup(file) {
    if (storageMode !== 'server') {
        alert('Uvoz radi samo na Vercel verziji stranice.');
        return;
    }

    var reader = new FileReader();
    reader.onload = function () {
        var data;
        try {
            data = JSON.parse(String(reader.result).replace(/^﻿/, ''));
        } catch (error) {
            alert('Datoteka nije ispravan JSON.');
            return;
        }
        if (!data || data.format !== 'horvati-izmjene') {
            alert('Ovo nije backup izmjena (treba datoteka horvati-izmjene-....json).');
            return;
        }

        var changes = [];
        var counts = { user: 0, skippedUser: 0, note: 0, details: 0, position: 0 };

        (Array.isArray(data.userItems) ? data.userItems : []).forEach(function (item) {
            if (!item || !item.id) return;
            var isBase = baseItems.some(function (b) { return b.id === item.id; });
            if (isBase || isDuplicateOfBase(item)) {
                counts.skippedUser += 1;
                return;
            }
            changes.push({ kind: 'user', id: String(item.id), value: item });
            counts.user += 1;
        });

        [['note', data.noteOverrides], ['details', data.plantDetails], ['position', data.positionOverrides]].forEach(function (pair) {
            var map = asPlainObject(pair[1]);
            Object.keys(map).forEach(function (id) {
                if (map[id] === null || map[id] === undefined) return;
                changes.push({ kind: pair[0], id: id, value: map[id] });
                counts[pair[0]] += 1;
            });
        });

        if (changes.length === 0) {
            alert('U backupu nema ničega za uvesti' + (counts.skippedUser ? ' (' + counts.skippedUser + ' stabala već postoji u osnovnim podacima).' : '.'));
            return;
        }

        var ok = confirm(
            'Uvesti na server:\n' +
            '- novih stabala: ' + counts.user + (counts.skippedUser ? ' (preskočeno jer već postoje: ' + counts.skippedUser + ')' : '') + '\n' +
            '- napomena: ' + counts.note + '\n' +
            '- statusa biljaka: ' + counts.details + '\n' +
            '- promjena lokacije: ' + counts.position + '\n\n' +
            'Postojeći zapisi za iste biljke bit će zamijenjeni ovima iz backupa.'
        );
        if (!ok) return;

        setSyncStatus('saving', '☁️ Uvozim backup...');
        fetch(STATE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync', changes: changes })
        })
            .then(function (response) {
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function () {
                alert('Uvoz gotov. Stranica će se osvježiti.');
                window.location.reload();
            })
            .catch(function (error) {
                console.error(error);
                setSyncStatus('error', '⚠️ Uvoz nije uspio.');
                alert('Uvoz nije uspio: ' + error.message);
            });
    };
    reader.readAsText(file);
}

function getTypeWithEmoji(typeOrItem) {
    var type;
    if (typeof typeOrItem === 'string') {
        type = normalizeType(typeOrItem);
    } else {
        type = normalizeType(typeOrItem.treeType);
    }
    var emojis = {
        jabuka: '🍎',
        kruska: '🍐',
        sljiva: '🍇',
        smokva: '🫠',
        breskva: '🍑',
        tresnja: '🍒',
        visnja: '🍒',
        glog: '🌳',
        drena: '🌳',
        drenak: '🌳',
        kupina: '🫐',
        ribizl: '🍓',
        dud2: '🌳',
        vinova_loza: '🍇',
        kivi: '🥝',
        ostalo: '🌳'
    };
    return type + (emojis[type] ? ' ' + emojis[type] : '');
}

function getTypeFromId(id) {
    if (!id) return null;
    var match = id.match(/^([a-zA-ZšđčćžŠĐČĆŽ]+)\d+/);
    if (match) {
        var type = match[1].toLowerCase();
        type = type.replace(/š/g, 's').replace(/đ/g, 'd').replace(/č/g, 'c').replace(/ć/g, 'c').replace(/ž/g, 'z');
        return type;
    }
    return null;
}

function getEmojiForType(item) {
    var type = normalizeType(item.treeType);
    var emojis = {
        jabuka: '🍎',
        kruska: '🍐',
        sljiva: '🍇',
        smokva: '🫠',
        breskva: '🍑',
        tresnja: '🍒',
        visnja: '🍒',
        glog: '🌳',
        drena: '🌳',
        drenak: '🌳',
        kupina: '🫐',
        ribizl: '🍓',
        dud2: '🌳',
        vinova_loza: '🍇',
        kivi: '🥝',
        ostalo: '🌳'
    };
    return emojis[type] || '🌿';
}

var VINE_DISPLAY_STEP = 5;
var ALWAYS_VISIBLE_VINE_IDS = {
    vinova_loza213: true,
    vinova_loza214: true,
    vinova_loza215: true,
    vinova_loza216: true,
    vinova_loza217: true,
    vinova_loza218: true
};
var FULL_ICON_SIZE = 30;
// Vrste koje se na karti prikazuju emojijem dok nemaju vlastitu sliku u icons/
var EMOJI_MARKERS = { ostalo: '🌳', kivi: '🥝' };
var VINE_DOT_SIZE = 4;
var VINE_DOT_HIT_MULTIPLIER = 4;
var AVG_YIELD_KG_BY_TYPE = {
    jabuka: 25,
    kruska: 20,
    sljiva: 18,
    breskva: 20,
    smokva: 15,
    kupina: 2,
    glog: 5,
    dunja: 15,
    tresnja: 18,
    visnja: 18,
    ribizl: 3.5,
    vinova_loza: 1.5,
    dud2: 15,
    kivi: 30,
    _default: 10
};

var REFERENCE_YIELD_BY_TYPE = {
    jabuka: { adultHeightM: 4.0, minKg: 30, maxKg: 80 },
    kruska: { adultHeightM: 4.5, minKg: 30, maxKg: 100 },
    sljiva: { adultHeightM: 4.0, minKg: 20, maxKg: 60 },
    breskva: { adultHeightM: 3.2, minKg: 15, maxKg: 40 },
    tresnja: { adultHeightM: 5.0, minKg: 30, maxKg: 80 },
    visnja: { adultHeightM: 5.0, minKg: 20, maxKg: 50 },
    smokva: { adultHeightM: 4.0, minKg: 20, maxKg: 60 },
    dunja: { adultHeightM: 3.8, minKg: 20, maxKg: 50 },
    glog: { adultHeightM: 4.0, minKg: 5, maxKg: 20 },
    drenak: { adultHeightM: 4.0, minKg: 10, maxKg: 30 },
    ribizl: { adultHeightM: 1.5, minKg: 3, maxKg: 4 },
    kupina: { adultHeightM: 2.0, minKg: 2, maxKg: 6 },
    vinova_loza: { adultHeightM: 2.0, minKg: 2, maxKg: 8 },
    kivi: { adultHeightM: 2.5, minKg: 20, maxKg: 50 },
    dud2: { adultHeightM: 6.0, minKg: 10, maxKg: 20 }
};

var STAGE_COEFFICIENT = {
    mlado: 0.2,
    u_razvoju: 0.6,
    odraslo: 1.0,
    _default: 1.0
};

var CANOPY_DENSITY_COEFFICIENT = {
    mala: 0.3,
    srednja: 0.7,
    velika: 1.0,
    _default: 1.0
};

var HEIGHT_FACTOR_ALPHA = 0.6;
var HEIGHT_FACTOR_MIN = 0.4;
var HEIGHT_FACTOR_MAX = 1.35;

// Potrebe za zalijevanjem: 0 = minimalno, 4 = visoko (svaki stupanj = 25%)
var WATER_NEED_LEVEL = {
    jabuka: 3,
    kruska: 3,
    breskva: 4,
    smokva: 1,
    kupina: 3,
    glog: 1,
    dunja: 2,
    sljiva: 3,
    tresnja: 3,
    visnja: 3,
    ribizl: 2,
    vinova_loza: 2,
    kivi: 4,
    _default: 2
};

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '') || 'oznaka';
}

function normalizeType(typeText) {
    var t = String(typeText || '').toLowerCase();
    var tAscii = t
        .replace(/š/g, 's')
        .replace(/đ/g, 'd')
        .replace(/č/g, 'c')
        .replace(/ć/g, 'c')
        .replace(/ž/g, 'z');
    if (t.indexOf('kivi') !== -1 || t.indexOf('kiwi') !== -1) return 'kivi';
    if (t.indexOf('jabuk') !== -1) return 'jabuka';
    if (t.indexOf('ribiz') !== -1) return 'ribizl';
    if (t.indexOf('kru') !== -1) return 'kruska';
    if (t.indexOf('bresk') !== -1) return 'breskva';
    if (t.indexOf('smok') !== -1) return 'smokva';
    if (t.indexOf('kupin') !== -1) return 'kupina';
    if (t.indexOf('glog') !== -1) return 'glog';
    if (t.indexOf('dunj') !== -1) return 'dunja';
    if (t.indexOf('plum') !== -1) return 'sljiva';
    if (t.indexOf('visn') !== -1) return 'visnja';
    if (t.indexOf('cherry') !== -1) return 'tresnja';
    if (t.indexOf('tres') !== -1 || t.indexOf('tre') !== -1) return 'tresnja';
    if (t.indexOf('sljiv') !== -1 || t.indexOf('slji') !== -1) return 'sljiva';
    if (tAscii.indexOf('visn') !== -1) return 'visnja';
    if (tAscii.indexOf('tres') !== -1 || tAscii.indexOf('tre') !== -1) return 'tresnja';
    if (tAscii.indexOf('sljiv') !== -1 || tAscii.indexOf('slji') !== -1) return 'sljiva';
    return slugify(typeText || 'stablo');
}

function iconByType(typeText) {
    var t = normalizeType(typeText);
    if (t === 'jabuka') return 'icons/apple.png';
    if (t === 'ribizl') return 'icons/ribiz.png';
    if (t === 'kruska') return 'icons/pear.png';
    if (t === 'breskva') return 'icons/peach.png';
    if (t === 'kupina') return 'icons/blackberry.png';
    if (t === 'smokva') return 'icons/fig.png';
    if (t === 'sljiva') return 'icons/plum.png';
    if (t === 'tresnja') return 'icons/cherry.png';
    if (t === 'visnja') return 'icons/visnja.png';
    if (t === 'dunja') return 'icons/dunja.png';
    if (t === 'glog') return 'icons/glog.png';
    if (t === 'vinova_loza') return 'icons/grapes.png';
    return null;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getAverageYieldKg(item) {
    var t = normalizeType(item && item.treeType ? item.treeType : '');
    return AVG_YIELD_KG_BY_TYPE[t] || AVG_YIELD_KG_BY_TYPE._default;
}

function formatKg(value) {
    return Number(value).toFixed(1).replace(/\.0$/, '');
}

function formatMeters(value) {
    var numeric = typeof value === 'number' ? value : Number(value);
    if (!numeric || numeric <= 0) return '-';
    return formatKg(numeric) + ' m';
}

function normalizeCanopyDensity(value) {
    var t = String(value || '').toLowerCase();
    if (!t) return '';
    var tAscii = t
        .replace(/š/g, 's')
        .replace(/đ/g, 'd')
        .replace(/č/g, 'c')
        .replace(/ć/g, 'c')
        .replace(/ž/g, 'z');
    if (t.indexOf('mala') !== -1 || t.indexOf('malo') !== -1 || tAscii.indexOf('mala') !== -1 || tAscii.indexOf('malo') !== -1) return 'mala';
    if (t.indexOf('sred') !== -1 || tAscii.indexOf('sred') !== -1) return 'srednja';
    if (t.indexOf('velik') !== -1 || t.indexOf('jako') !== -1 || tAscii.indexOf('velik') !== -1 || tAscii.indexOf('jako') !== -1) return 'velika';
    return '';
}

function normalizeGrowthStage(value) {
    var t = String(value || '').toLowerCase();
    if (!t) return '';
    var tAscii = t
        .replace(/š/g, 's')
        .replace(/đ/g, 'd')
        .replace(/č/g, 'c')
        .replace(/ć/g, 'c')
        .replace(/ž/g, 'z');
    if (t.indexOf('mlad') !== -1 || tAscii.indexOf('mlad') !== -1) return 'mlado';
    if (t.indexOf('razvoj') !== -1 || tAscii.indexOf('razvoj') !== -1) return 'u_razvoju';
    if (t.indexOf('odras') !== -1 || tAscii.indexOf('odras') !== -1) return 'odraslo';
    return '';
}

function getReferenceYield(typeKey) {
    if (REFERENCE_YIELD_BY_TYPE[typeKey]) return REFERENCE_YIELD_BY_TYPE[typeKey];
    var avg = AVG_YIELD_KG_BY_TYPE[typeKey] || AVG_YIELD_KG_BY_TYPE._default;
    return {
        adultHeightM: null,
        minKg: avg,
        maxKg: avg
    };
}

function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
}

function getHeightFactor(item, reference) {
    var h = item && typeof item.heightM === 'number' ? item.heightM : Number(item && item.heightM);
    if (!h || h <= 0 || !reference || !reference.adultHeightM) return 1;
    var ratio = h / reference.adultHeightM;
    var raw = Math.pow(ratio, HEIGHT_FACTOR_ALPHA);
    return clamp(raw, HEIGHT_FACTOR_MIN, HEIGHT_FACTOR_MAX);
}

function getYieldRangeKg(item) {
    var t = normalizeType(item && item.treeType ? item.treeType : '');
    var density = normalizeCanopyDensity(item && item.canopyDensity ? item.canopyDensity : '');
    var stage = normalizeGrowthStage(item && item.growthStage ? item.growthStage : '');
    var stageFactor = STAGE_COEFFICIENT[stage] !== undefined ? STAGE_COEFFICIENT[stage] : STAGE_COEFFICIENT._default;
    var densityFactor = CANOPY_DENSITY_COEFFICIENT[density] !== undefined ? CANOPY_DENSITY_COEFFICIENT[density] : CANOPY_DENSITY_COEFFICIENT._default;
    var reference = getReferenceYield(t);
    var heightFactor = getHeightFactor(item, reference);
    var totalFactor = stageFactor * densityFactor * heightFactor;

    if (t === 'ribizl') {
        var baseMin = 3.0;
        var baseMax = 4.0;
        if (density === 'mala') {
            baseMin = 0.5;
            baseMax = 1.0;
        } else if (density === 'srednja') {
            baseMin = 1.5;
            baseMax = 2.5;
        }
        return {
            min: baseMin * stageFactor * heightFactor,
            max: baseMax * stageFactor * heightFactor,
            density: density || 'velika'
        };
    }

    return {
        min: reference.minKg * totalFactor,
        max: reference.maxKg * totalFactor,
        density: density || ''
    };
}

function renderYieldTable() {
    var body = document.getElementById('yield-table-body');
    var summary = document.getElementById('yield-summary');
    if (!body || !summary) return;

    // "Ostalo" (stabla/grmovi koji nisu voćke) ne ulazi u procjenu uroda.
    var merged = baseItems.concat(userItems).filter(function (item) {
        return normalizeType(item.treeType) !== 'ostalo';
    });
    if (!merged.length) {
        body.innerHTML = '<tr><td colspan="3">Nema podataka.</td></tr>';
        summary.innerHTML = '<p>Ukupni ocekivani urod: 0-0 kg</p>';
        return;
    }

    var grouped = {};
    var totalMinAll = 0;
    var totalMaxAll = 0;

    merged.forEach(function (item) {
        var typeKey = normalizeType(item.treeType);
        var range = getYieldRangeKg(item);
        var density = range.density || '';
        var rangeKey = Number(range.min).toFixed(3) + '|' + Number(range.max).toFixed(3);
        var groupKey = typeKey + '|' + density + '|' + rangeKey;

        if (!grouped[groupKey]) {
            grouped[groupKey] = {
                type: typeKey,
                density: density,
                count: 0,
                minEach: range.min,
                maxEach: range.max,
                minTotal: 0,
                maxTotal: 0
            };
        }

        grouped[groupKey].count += 1;
        grouped[groupKey].minTotal += range.min;
        grouped[groupKey].maxTotal += range.max;
        totalMinAll += range.min;
        totalMaxAll += range.max;
    });

    var summaryByType = {};
    Object.keys(grouped).forEach(function (key) {
        var group = grouped[key];
        if (!summaryByType[group.type]) {
            summaryByType[group.type] = {
                min: 0,
                max: 0,
                parts: []
            };
        }
        summaryByType[group.type].min += group.minTotal;
        summaryByType[group.type].max += group.maxTotal;

        summaryByType[group.type].parts.push(group.count + 'x ' + formatKg(group.minEach) + '-' + formatKg(group.maxEach));
    });

    var groupedRows = Object.keys(summaryByType)
        .sort()
        .map(function (type) {
            var info = summaryByType[type];
            return '<tr>' +
                '<td>' + escapeHtml(getTypeWithEmoji(type)) + '</td>' +
                '<td>' + escapeHtml(info.parts.join(' + ')) + '</td>' +
                '<td>' + escapeHtml(formatKg(info.min) + '-' + formatKg(info.max) + ' kg') + '</td>' +
                '</tr>';
        });

    body.innerHTML = groupedRows.join('');

    var summaryLines = Object.keys(summaryByType)
        .sort()
        .map(function (type) {
            var info = summaryByType[type];
            return '<p>Ocekivano ' + formatKg(info.min) + '-' + formatKg(info.max) + ' kg: ' + escapeHtml(getTypeWithEmoji(type)) + '</p>';
        });
    summaryLines.push('<p><b>Ukupno ocekivano: ' + formatKg(totalMinAll) + '-' + formatKg(totalMaxAll) + ' kg</b></p>');
    summary.innerHTML = summaryLines.join('');
}

function nextGlobalIdNumber() {
    var maxNumber = 0;
    // Uključi i izbrisana stabla, da novo stablo nikad ne dobije ID izbrisanog.
    var all = baseItems.concat(userItems).concat(Object.keys(deletedIds).map(function (id) { return { id: id }; }));
    all.forEach(function (item) {
        var match = String(item.id || '').match(/(\d+)$/);
        if (!match) return;
        var n = Number(match[1]);
        if (n > maxNumber) maxNumber = n;
    });
    return maxNumber + 1;
}

function makeFallbackId(item, index) {
    return slugify(item.name) + '_' + Number(item.lat).toFixed(2) + '_' + Number(item.lng).toFixed(2) + '_' + index;
}

function buildMarkerIcon(item, isUserItem) {
    var normalizedType = normalizeType(item.treeType);
    var isVine = normalizedType === 'vinova_loza';
    var isMinorBaseVine = !isUserItem && isVine && !baseVisibleVineIds[item.id];

    if (isMinorBaseVine) {
        var dotSize = VINE_DOT_SIZE;
        var dotHit = dotSize * VINE_DOT_HIT_MULTIPLIER;
        var pad = Math.round((dotHit - dotSize) / 2);
        return L.divIcon({
            className: 'vine-dot-wrapper',
            html: '<span style="display:block;position:relative;width:' + dotHit + 'px;height:' + dotHit + 'px;border-radius:50%;background:rgba(255,255,0,0.35);">' +
                '<span style="position:absolute;left:' + pad + 'px;top:' + pad + 'px;width:' + dotSize + 'px;height:' + dotSize + 'px;border-radius:50%;background:#111;"></span>' +
                '</span>',
            iconSize: [dotHit, dotHit],
            iconAnchor: [Math.round(dotHit / 2), Math.round(dotHit / 2)]
        });
    }

    if (waterFilterEnabled) {
        return buildWaterIcon(item);
    }

    var markerEmoji = EMOJI_MARKERS[normalizedType];
    if (markerEmoji && !iconByType(item.treeType)) {
        // Vrste bez vlastite slike: emoji (Ostalo = stablo, Kivi = kivi)
        return L.divIcon({
            className: 'emoji-marker',
            html: '<span>' + markerEmoji + '</span>',
            iconSize: [FULL_ICON_SIZE, FULL_ICON_SIZE],
            iconAnchor: [Math.round(FULL_ICON_SIZE / 2), FULL_ICON_SIZE],
            popupAnchor: [0, -FULL_ICON_SIZE]
        });
    }

    var resolvedIcon = iconByType(item.treeType);
    if (!resolvedIcon) {
        return null; // Nema ikone, koristi default marker
    }

    var iconSize = FULL_ICON_SIZE;
    return L.icon({
        iconUrl: resolvedIcon,
        iconSize: [iconSize, iconSize],
        iconAnchor: [Math.round(iconSize / 2), iconSize],
        popupAnchor: [0, -iconSize]
    });
}

function buildWaterIcon(item) {
    var t = normalizeType(item.treeType);
    var level = WATER_NEED_LEVEL[t] !== undefined ? WATER_NEED_LEVEL[t] : WATER_NEED_LEVEL._default;
    var resolvedIcon = iconByType(item.treeType);
    var size = FULL_ICON_SIZE;
    var drops = '';
    for (var i = 0; i < 4; i++) { drops += i < level ? '💧' : '<span style="opacity:0.25">💧</span>'; }
    var imgHtml = resolvedIcon
        ? '<img src="' + resolvedIcon + '" style="width:' + size + 'px;height:' + size + 'px;display:block;">'
        : '<div style="width:' + size + 'px;height:' + size + 'px;background:#3388ff;border-radius:50%;"></div>';
    return L.divIcon({
        className: 'water-need-icon',
        html: '<div style="display:flex;flex-direction:column;align-items:center;line-height:1;">'
            + imgHtml
            + '<div style="font-size:8px;letter-spacing:-1px;margin-top:1px;">' + drops + '</div>'
            + '</div>',
        iconSize: [size, size + 12],
        iconAnchor: [Math.round(size / 2), size]
    });
}

function refreshAllMarkerIcons() {
    Object.keys(allMarkersById).forEach(function (id) {
        var marker = allMarkersById[id];
        var item = allItemsById[id];
        if (!marker || !item) return;
        var isUserItem = userItems.some(function (u) { return u.id === id; });
        var newIcon = buildMarkerIcon(item, isUserItem);
        if (newIcon) marker.setIcon(newIcon);
        highlightSelectedMarker(); // setIcon stvara novi element, pa ponovno označi odabrano
    });
}

function buildExportPayload() {
    var merged = baseItems.concat(userItems);
    return {
        meta: {
            naziv: 'Horvati vocnjak',
            verzija: 1,
            opis: 'Izvoz oznaka iz aplikacije',
            generatedAt: new Date().toISOString()
        },
        items: merged.map(toExportItem)
    };
}

function saveUserItems() {
    if (storageMode === 'server') {
        queueServerSync('user', userItemsAsMap(userItems));
        return;
    }
    try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userItems));
    } catch (error) {
        console.error('Ne mogu spremiti userItems:', error);
    }
}

function remapObjectKeysById(objectMap, idMap) {
    var changed = false;
    if (!objectMap || typeof objectMap !== 'object') return changed;

    Object.keys(idMap).forEach(function (oldId) {
        var newId = idMap[oldId];
        if (!newId || oldId === newId) return;
        if (!Object.prototype.hasOwnProperty.call(objectMap, oldId)) return;

        if (!Object.prototype.hasOwnProperty.call(objectMap, newId)) {
            objectMap[newId] = objectMap[oldId];
        }
        delete objectMap[oldId];
        changed = true;
    });

    return changed;
}

function makeUniqueRenamedId(oldId, preferredPrefix, usedIds) {
    var suffixMatch = String(oldId || '').match(/(\d+)$/);
    var suffix = suffixMatch ? suffixMatch[1] : '';
    var baseCandidate = preferredPrefix + suffix;
    var candidate = baseCandidate;

    if (!candidate || candidate === preferredPrefix) {
        candidate = preferredPrefix + '001';
        baseCandidate = candidate;
    }

    var counter = 1;
    while (usedIds[candidate]) {
        candidate = baseCandidate + '_' + counter;
        counter += 1;
    }

    usedIds[candidate] = true;
    return candidate;
}

function loadUserItems() {
    try {
        var parsed;
        if (storageMode === 'server') {
            parsed = serverUserItemsRaw || [];
        } else {
            var raw = localStorage.getItem(USER_STORAGE_KEY);
            if (!raw) return [];
            parsed = JSON.parse(raw);
        }
        if (!Array.isArray(parsed)) return [];

        var corrected = false;
        var idMap = {};
        var usedIds = {};

        baseItems.forEach(function (item) {
            if (item && item.id) usedIds[item.id] = true;
        });
        parsed.forEach(function (item) {
            if (item && item.id) usedIds[item.id] = true;
        });

        var normalized = parsed.map(function (item) {
            if (!item || typeof item !== 'object') return item;

            var nameNorm = normalizeText(item.name);
            var typeNorm = normalizeType(item.treeType);
            if (typeNorm === 'jabuka' && nameNorm.indexOf('ribiz') !== -1) {
                corrected = true;
                item.treeType = 'ribizl';
                item.iconUrl = iconByType('ribizl');

                if (item.id && String(item.id).indexOf('jabuka') === 0) {
                    var oldId = item.id;
                    delete usedIds[oldId];
                    var newId = makeUniqueRenamedId(oldId, 'ribizl', usedIds);
                    item.id = newId;
                    idMap[oldId] = newId;
                }
            }

            return item;
        });

        if (corrected) {
            if (Object.keys(idMap).length > 0) {
                var detailsChanged = remapObjectKeysById(plantDetails, idMap);
                if (detailsChanged) savePlantDetails();

                var positionsChanged = remapObjectKeysById(positionOverrides, idMap);
                if (positionsChanged) savePositionOverrides();

                var notesChanged = remapObjectKeysById(noteOverrides, idMap);
                if (notesChanged) saveNoteOverrides();
            }

            if (storageMode !== 'server') {
                localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalized));
            }
        }

        return normalized;
    } catch (error) {
        console.error('Ne mogu učitati userItems:', error);
        return [];
    }
}

function saveNoteOverrides() {
    if (storageMode === 'server') {
        queueServerSync('note', noteOverrides);
        return;
    }
    try {
        localStorage.setItem(NOTE_STORAGE_KEY, JSON.stringify(noteOverrides));
    } catch (error) {
        console.error('Ne mogu spremiti napomene:', error);
    }
}

function loadNoteOverrides() {
    try {
        var raw = localStorage.getItem(NOTE_STORAGE_KEY);
        if (!raw) return {};
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Ne mogu učitati napomene:', error);
        return {};
    }
}

function savePlantDetails() {
    if (storageMode === 'server') {
        queueServerSync('details', plantDetails);
        return;
    }
    try {
        localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(plantDetails));
    } catch (error) {
        console.error('Ne mogu spremiti detalje biljke:', error);
    }
}

function loadPlantDetails() {
    try {
        var raw = localStorage.getItem(DETAILS_STORAGE_KEY);
        if (!raw) return {};
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Ne mogu učitati detalje biljke:', error);
        return {};
    }
}

function savePositionOverrides() {
    if (storageMode === 'server') {
        queueServerSync('position', positionOverrides);
        return;
    }
    try {
        localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(positionOverrides));
    } catch (error) {
        console.error('Ne mogu spremiti promjene lokacije:', error);
    }
}

function loadPositionOverrides() {
    try {
        var raw = localStorage.getItem(POSITION_STORAGE_KEY);
        if (!raw) return {};
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Ne mogu učitati promjene lokacije:', error);
        return {};
    }
}

function getPlantDetails(itemId) {
    return plantDetails[itemId] || {
        orezano: 'nepoznato',
        gnojeno: 'nepoznato',
        spricano: '',
        napomena: ''
    };
}

function toExportItem(item, index) {
    var treeType = item.treeType || 'stablo';
    var lowerType = String(treeType).toLowerCase();
    var category = lowerType.indexOf('loza') !== -1 ? 'loza' : 'stablo';
    var baseId = slugify(item.name || (category + '_' + (index + 1)));

    var exportItem = {
        id: item.id || (baseId + '_' + (index + 1)),
        kategorija: category,
        vrsta: treeType,
        naziv: item.name || baseId,
        lat: Number(item.lat),
        lng: Number(item.lng),
        napomena: item.notes || '',
        ikonica: item.iconUrl || null
    };

    if (item.heightM !== null && item.heightM !== undefined && item.heightM !== '') {
        exportItem.visina_m = typeof item.heightM === 'number' ? item.heightM : Number(item.heightM);
    }
    if (item.growthStage) {
        exportItem.stadij_razvoja = item.growthStage;
    }
    if (item.canopyDensity) {
        exportItem.gustoca_krosnje = item.canopyDensity;
    }

    return exportItem;
}

function downloadJson() {
    var payload = buildExportPayload();

    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var now = new Date();
    var datePart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'stabla-export-' + datePart + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function renderChangeList() {
    var list = document.getElementById('tree-list-items');
    if (!list) return;

    var rows = [];

    userItems.forEach(function (item) {
        rows.push(
            '<li><span>NOVO: ' + item.id + ' | ' + item.name + ' (' + item.treeType + ')</span>' +
            '<button class="remove-tree" data-id="' + item.id + '" title="Obriši novo stablo">x</button></li>'
        );
    });

    Object.keys(noteOverrides).forEach(function (itemId) {
        var isUser = userItems.some(function (u) { return u.id === itemId; });
        if (isUser) return;
        var item = allItemsById[itemId];
        if (!item) return;
        rows.push(
            '<li><span>PROMJENA NAPOMENE: ' + item.id + ' | ' + item.name + '</span>' +
            '<button class="remove-detail" data-id="' + item.id + '" title="Makni promjenu napomene">x</button></li>'
        );
    });

    Object.keys(plantDetails).forEach(function (itemId) {
        var isUser = userItems.some(function (u) { return u.id === itemId; });
        if (isUser) return;
        if (noteOverrides[itemId]) return;

        var detail = plantDetails[itemId] || {};
        var hasChange = !!(detail.orezano && detail.orezano !== 'nepoznato') ||
            !!(detail.gnojeno && detail.gnojeno !== 'nepoznato') ||
            !!(detail.spricano) ||
            !!(detail.napomena);
        if (!hasChange) return;

        var item = allItemsById[itemId];
        if (!item) return;
        rows.push(
            '<li><span>PROMJENA STATUSA: ' + item.id + ' | ' + item.name + '</span>' +
            '<button class="remove-detail" data-id="' + item.id + '" data-kind="status" title="Makni promjenu statusa">x</button></li>'
        );
    });

    Object.keys(positionOverrides).forEach(function (itemId) {
        var isUser = userItems.some(function (u) { return u.id === itemId; });
        if (isUser) return;

        var item = allItemsById[itemId];
        if (!item) return;
        rows.push(
            '<li><span>PROMJENA LOKACIJE: ' + item.id + ' | ' + item.name + ' -> ' + Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2) + '</span>' +
            '<button class="remove-detail" data-id="' + item.id + '" data-kind="position" title="Makni promjenu lokacije">x</button></li>'
        );
    });

    if (rows.length === 0) {
        rows.push('<li><span>Nema spremljenih izmjena.</span></li>');
    }

    list.innerHTML = rows.join('');
}

function clearBaseItemChanges(itemId) {
    delete noteOverrides[itemId];
    saveNoteOverrides();

    delete plantDetails[itemId];
    savePlantDetails();

    var item = allItemsById[itemId];
    if (item) {
        item.notes = baseOriginalNotesById[itemId] || '';
    }

    if (selectedPlant && selectedPlant.itemId === itemId) {
        selectedPlant = null;
        highlightSelectedMarker();
        var emptyEl = document.getElementById('plant-empty');
        var formEl = document.getElementById('plant-form');
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (formEl) formEl.classList.add('hidden');
    }

    renderChangeList();
}

// TEST: dodano radi provjere push-a
console.log('Testni commit za push: novi sadržaj je dodan u script.js');

function clearBaseItemPosition(itemId) {
    delete positionOverrides[itemId];
    savePositionOverrides();

    var original = baseOriginalPositionsById[itemId];
    var item = allItemsById[itemId];
    if (original && item) {
        item.lat = original.lat;
        item.lng = original.lng;

        var marker = allMarkersById[itemId];
        if (marker) marker.setLatLng([original.lat, original.lng]);

        if (selectedPlant && selectedPlant.itemId === itemId) {
            document.getElementById('plant-coords').textContent = Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2);
        }
    }

    renderChangeList();
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function isDuplicateOfBase(userItem) {
    var uName = normalizeText(userItem.name);
    var uType = normalizeText(userItem.treeType);
    var uLat = Number(userItem.lat).toFixed(2);
    var uLng = Number(userItem.lng).toFixed(2);

    return baseItems.some(function (baseItem) {
        return normalizeText(baseItem.name) === uName &&
            normalizeText(baseItem.treeType) === uType &&
            Number(baseItem.lat).toFixed(2) === uLat &&
            Number(baseItem.lng).toFixed(2) === uLng;
    });
}

function cleanupLegacyUserDuplicates() {
    if (!Array.isArray(userItems) || userItems.length === 0 || baseItems.length === 0) return;
    var before = userItems.length;
    userItems = userItems.filter(function (item) {
        return !isDuplicateOfBase(item);
    });

    if (userItems.length !== before) {
        saveUserItems();
    }
}

function editNoteFromListItem(itemId) {
    var item = allItemsById[itemId];
    if (!item) return;

    var current = item.notes || '';
    var newNote = prompt('Napomena za: ' + item.name, current);
    if (newNote === null) return;

    var cleaned = newNote.trim();
    var isUserItem = userItems.some(function (i) { return i.id === itemId; });
    applyNote(item, cleaned, isUserItem);
}

function applyNote(item, noteText, isUserItem) {
    item.notes = noteText;

    if (isUserItem) {
        var found = userItems.find(function (i) { return i.id === item.id; });
        if (found) {
            found.notes = noteText;
        }
        saveUserItems();
    } else {
        if (noteText) {
            noteOverrides[item.id] = noteText;
        } else {
            delete noteOverrides[item.id];
        }
        saveNoteOverrides();
    }

    renderChangeList();
}

function openPlantPanel(item, isUserItem) {
    if (plantPanelAutosaveTimer) {
        clearTimeout(plantPanelAutosaveTimer);
        plantPanelAutosaveTimer = null;
    }

    if (plantPanelEl && plantPanelEl.classList.contains('minimized')) {
        plantPanelEl.classList.remove('minimized');
        if (togglePlantPanelBtn) {
            togglePlantPanelBtn.textContent = 'x';
            togglePlantPanelBtn.title = 'Minimiziraj panel';
        }
    }

    selectedPlant = {
        itemId: item.id,
        isUserItem: !!isUserItem
    };
    highlightSelectedMarker();

    var emptyEl = document.getElementById('plant-empty');
    var formEl = document.getElementById('plant-form');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (formEl) formEl.classList.remove('hidden');

    document.getElementById('plant-id').textContent = item.id || '-';
    document.getElementById('plant-type').textContent = item.treeType || '-';
    document.getElementById('plant-height').textContent = formatMeters(item.heightM);
    document.getElementById('plant-coords').textContent = Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2);

    var waterEl = document.getElementById('plant-water');
    if (waterEl) {
        var t = normalizeType(item.treeType);
        var level = WATER_NEED_LEVEL[t] !== undefined ? WATER_NEED_LEVEL[t] : WATER_NEED_LEVEL._default;
        var drops = '';
        for (var i = 0; i < 4; i++) { drops += i < level ? '\uD83D\uDCA7' : '\u25CB'; }
        waterEl.textContent = drops;
    }

    var details = getPlantDetails(item.id);
    document.getElementById('status-orezano').value = details.orezano || 'nepoznato';
    document.getElementById('status-gnojeno').value = details.gnojeno || 'nepoznato';
    document.getElementById('status-spricano').value = details.spricano || '';

    var noteInput = document.getElementById('status-napomena');
    noteInput.value = details.napomena || item.notes || '';
    noteInput.setAttribute('readonly', 'readonly');
    updatePlantFormEditable();
}

function saveSelectedPlantPanel() {
    if (!selectedPlant || !canEdit()) return;
    var item = allItemsById[selectedPlant.itemId];
    if (!item) return;

    var details = {
        orezano: document.getElementById('status-orezano').value,
        gnojeno: document.getElementById('status-gnojeno').value,
        spricano: document.getElementById('status-spricano').value.trim(),
        napomena: document.getElementById('status-napomena').value.trim()
    };

    plantDetails[item.id] = details;
    savePlantDetails();

    item.notes = details.napomena;
    applyNote(item, details.napomena, selectedPlant.isUserItem);
}

var plantPanelAutosaveTimer = null;

function queuePlantPanelAutosave(delayMs) {
    if (plantPanelAutosaveTimer) {
        clearTimeout(plantPanelAutosaveTimer);
    }

    plantPanelAutosaveTimer = setTimeout(function () {
        plantPanelAutosaveTimer = null;
        saveSelectedPlantPanel();
    }, delayMs || 700);
}

function flushPlantPanelAutosave() {
    if (plantPanelAutosaveTimer) {
        clearTimeout(plantPanelAutosaveTimer);
        plantPanelAutosaveTimer = null;
    }

    saveSelectedPlantPanel();
}

function createMarker(item, options) {
    var opts = options || {};
    var markerOptions = {};

    var dynamicIcon = buildMarkerIcon(item, !!opts.isUserItem);
    if (dynamicIcon) markerOptions.icon = dynamicIcon;

    markerOptions.draggable = dragEnabled;

    var marker = L.marker([item.lat, item.lng], markerOptions).addTo(map);
    if (item.id) {
        allMarkersById[item.id] = marker;
    }

    marker.on('click', function () {
        openPlantPanel(item, !!opts.isUserItem);
    });

    if (opts.isUserItem && item.id) {
        userMarkersById[item.id] = marker;
    }

    marker.on('dragend', function () {
        var newLatLng = marker.getLatLng();
        item.lat = newLatLng.lat;
        item.lng = newLatLng.lng;

        if (selectedPlant && selectedPlant.itemId === item.id) {
            document.getElementById('plant-coords').textContent = Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2);
        }

        if (opts.isUserItem) {
            var found = userItems.find(function (i) { return i.id === item.id; });
            if (found) {
                found.lat = newLatLng.lat;
                found.lng = newLatLng.lng;
            }
            saveUserItems();
        } else if (item.id) {
            positionOverrides[item.id] = {
                lat: Number(newLatLng.lat),
                lng: Number(newLatLng.lng)
            };
            savePositionOverrides();
        }

        renderChangeList();
    });

    return marker;
}

function removeUserItem(userId) {
    var marker = userMarkersById[userId];
    if (marker) {
        map.removeLayer(marker);
        delete userMarkersById[userId];
        delete allMarkersById[userId];
    }

    userItems = userItems.filter(function (item) {
        return item.id !== userId;
    });

    delete allItemsById[userId];
    saveUserItems();
    renderChangeList();
}

function normalizeItems(data) {
    if (data && Array.isArray(data.items)) {
        return data.items.map(function (item, index) {
            return {
                id: item.id || makeFallbackId({
                    name: item.naziv || 'Bez_naziva',
                    lat: item.lat,
                    lng: item.lng
                }, index),
                name: item.naziv || item.id || 'Bez naziva',
                treeType: item.vrsta || item.kategorija || 'Stablo',
                lat: Number(item.lat),
                lng: Number(item.lng),
                notes: item.napomena || '',
                growthStage: item.stadij_razvoja || '',
                heightM: typeof item.visina_m === 'number' ? item.visina_m : Number(item.visina_m) || null,
                canopyDensity: item.gustoca_krosnje || '',
                iconUrl: item.ikonica || null
            };
        });
    }

    if (data && Array.isArray(data.trees)) {
        return data.trees.map(function (tree, index) {
            return {
                id: tree.id || makeFallbackId({ name: tree.name || 'stablo', lat: tree.lat, lng: tree.lng }, index),
                name: tree.name || 'Bez naziva',
                treeType: 'stablo',
                lat: Number(tree.lat),
                lng: Number(tree.lng),
                notes: tree.notes || '',
                iconUrl: tree.image || null
            };
        });
    }

    return [];
}

function computeVisibleBaseVineIds(items) {
    baseVisibleVineIds = {};

    Object.keys(ALWAYS_VISIBLE_VINE_IDS).forEach(function (id) {
        baseVisibleVineIds[id] = true;
    });

    var vines = items
        .filter(function (item) {
            return normalizeType(item.treeType) === 'vinova_loza';
        })
        .map(function (item) {
            var match = String(item.id || '').match(/(\d+)$/);
            var n = match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
            return { id: item.id, n: n };
        })
        .sort(function (a, b) {
            return a.n - b.n;
        });

    vines.forEach(function (vine, index) {
        if (index % VINE_DISPLAY_STEP === 0) {
            baseVisibleVineIds[vine.id] = true;
        }
    });
}

function shouldRenderBaseItem(item) {
    if (normalizeType(item.treeType) !== 'vinova_loza') return true;
    return !!baseVisibleVineIds[item.id];
}

function applyStoredNotesToBaseItems() {
    baseOriginalNotesById = {};
    baseItems.forEach(function (item) {
        baseOriginalNotesById[item.id] = item.notes || '';
        var detail = getPlantDetails(item.id);
        if (detail.napomena) item.notes = detail.napomena;
        else if (noteOverrides[item.id]) item.notes = noteOverrides[item.id];
    });
}

function applyStoredPositionsToBaseItems() {
    baseOriginalPositionsById = {};
    baseItems.forEach(function (item) {
        baseOriginalPositionsById[item.id] = {
            lat: Number(item.lat),
            lng: Number(item.lng)
        };

        var moved = positionOverrides[item.id];
        if (moved && typeof moved.lat === 'number' && typeof moved.lng === 'number') {
            item.lat = Number(moved.lat);
            item.lng = Number(moved.lng);
        }
    });
}

function registerAllItemsMap() {
    allItemsById = {};
    baseItems.forEach(function (item) { allItemsById[item.id] = item; });
    userItems.forEach(function (item) { allItemsById[item.id] = item; });
}

function loadInventory() {
    Promise.all([fetchServerState(), fetchAdminStatus()])
        .then(function (results) {
            var state = results[0];
            if (!state) {
                storageMode = 'local';
                setSyncStatus('local');
                setAdminMode(true);
                loadInventoryLegacy();
                return;
            }

            storageMode = 'server';
            var loginPanel = document.getElementById('login-panel');
            if (loginPanel) loginPanel.classList.remove('hidden');
            if (isOfflineData) {
                // Offline: samo pregled, da se izmjene ne izgube
                if (loginPanel) loginPanel.classList.add('hidden');
                setAdminMode(false);
                showOfflineBanner();
            } else {
                setAdminMode(results[1]);
            }

            return ensureServerSeeded(state).then(function (seededState) {
                applyServerState(seededState);
                baseItems = normalizeItems(seededState.stabla).concat(normalizeItems(seededState.loza))
                    .filter(function (item) { return !deletedIds[item.id]; });
                computeVisibleBaseVineIds(baseItems);
                applyStoredPositionsToBaseItems();
                applyStoredNotesToBaseItems();

                userItems = loadUserItems();
                cleanupLegacyUserDuplicates();

                baseItems.forEach(function (item) {
                    createMarker(item, { isUserItem: false });
                });

                userItems.forEach(function (item, index) {
                    if (!item.id) {
                        item.id = 'user_' + Date.now() + '_' + index;
                    }
                    createMarker(item, { isUserItem: true });
                });

                registerAllItemsMap();
                saveUserItems();
                renderChangeList();
                if (!hasUnsavedChanges()) setSyncStatus('ok');
            });
        })
        .catch(function (error) {
            console.error('Greška pri učitavanju podataka sa servera:', error);
            setSyncStatus('error', '⚠️ Ne mogu učitati podatke sa servera: ' + error.message);
            alert('Ne mogu učitati podatke sa servera. Osvježi stranicu za par trenutaka. ' + error.message);
        });
}

function loadInventoryLegacy() {
    noteOverrides = loadNoteOverrides();
    plantDetails = loadPlantDetails();
    positionOverrides = loadPositionOverrides();

    fetch('data/stabla.json?v=20260328a')
        .then(function (response) {
            if (!response.ok) throw new Error('Nema data/stabla.json');
            return response.json();
        })
        .then(function (stablaData) {
            return fetch('data/loza.json?v=20260328a')
                .then(function (response) {
                    if (!response.ok) throw new Error('Nema data/loza.json');
                    return response.json();
                })
                .catch(function () {
                    return { items: [] };
                })
                .then(function (lozaData) {
                    return {
                        stablaData: stablaData,
                        lozaData: lozaData
                    };
                });
        })
        .then(function (mergedData) {
            baseItems = normalizeItems(mergedData.stablaData).concat(normalizeItems(mergedData.lozaData));
            computeVisibleBaseVineIds(baseItems);
            applyStoredPositionsToBaseItems();
            applyStoredNotesToBaseItems();

            userItems = loadUserItems();
            cleanupLegacyUserDuplicates();

            baseItems.forEach(function (item) {
                createMarker(item, { isUserItem: false });
            });

            userItems.forEach(function (item, index) {
                if (!item.id) {
                    item.id = 'user_' + Date.now() + '_' + index;
                }
                createMarker(item, { isUserItem: true });
            });

            registerAllItemsMap();
            saveUserItems();
            renderChangeList();
        })
        .catch(function () {
            fetch('data/trees.json')
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    baseItems = normalizeItems(data);
                    computeVisibleBaseVineIds(baseItems);
                    applyStoredPositionsToBaseItems();
                    applyStoredNotesToBaseItems();

                    userItems = loadUserItems();
                    cleanupLegacyUserDuplicates();

                    baseItems.forEach(function (item) {
                        createMarker(item, { isUserItem: false });
                    });

                    userItems.forEach(function (item, index) {
                        if (!item.id) {
                            item.id = 'user_' + Date.now() + '_' + index;
                        }
                        createMarker(item, { isUserItem: true });
                    });

                    registerAllItemsMap();
                    saveUserItems();
                    renderChangeList();
                })
                .catch(function (error) {
                    console.error('Greška pri učitavanju podataka:', error);
                    userItems = loadUserItems();
                    userItems.forEach(function (item, index) {
                        if (!item.id) {
                            item.id = 'user_' + Date.now() + '_' + index;
                        }
                        createMarker(item, { isUserItem: true });
                    });

                    registerAllItemsMap();
                    saveUserItems();
                    renderChangeList();
                });
        });
}

loadInventory();

function renderWeather(data) {
    var updatedEl = document.getElementById('weather-updated');
    var statusEl = document.getElementById('weather-status');
    var rainEl = document.getElementById('weather-rain-value');
    var forecastEl = document.getElementById('weather-forecast');
    var historyEl = document.getElementById('weather-history-body');
    if (!updatedEl || !statusEl || !rainEl || !forecastEl || !historyEl) return;

    var rain = data.rainfall24h || {};
    rainEl.textContent = Number(rain.rainfallMm || 0).toLocaleString('hr-HR') + ' mm';
    statusEl.textContent = rain.stationReported
        ? 'Podatak je pronađen na DHMZ popisu.'
        : 'Postaja nije navedena na popisu; prema dogovoru računa se 0 mm.';
    updatedEl.textContent = data.updatedAt
        ? new Date(data.updatedAt).toLocaleString('hr-HR')
        : 'Nema datuma';
    renderWeatherScores(data);
    forecastEl.innerHTML = '';
    historyEl.innerHTML = '';

    (data.forecast || []).forEach(function (day) {
        var card = document.createElement('div');
        card.className = 'weather-day';
        card.title = [day.night, day.morning, day.afternoon, day.evening].filter(Boolean).join(' | ');
        card.innerHTML = '<div class="weather-day-date"></div>'
            + '<div class="weather-day-temp"></div>'
            + '<div class="weather-day-rain"></div>';
        card.querySelector('.weather-day-date').textContent = day.date.replace(/\.2026$/, '').replace(/\.20\d\d$/, '');
        card.querySelector('.weather-day-temp').textContent = day.temperature || '-';
        card.querySelector('.weather-day-rain').textContent = day.precipitation || '-';
        forecastEl.appendChild(card);
    });

    (data.rainfallHistory || []).slice().reverse().forEach(function (record) {
        var row = document.createElement('tr');
        var date = record.observationDate
            ? new Date(record.observationDate + 'T12:00:00').toLocaleDateString('hr-HR')
            : (record.recordedAt ? new Date(record.recordedAt).toLocaleDateString('hr-HR') : '-');
        row.innerHTML = '<td></td><td></td><td></td><td></td><td></td><td></td>';
        row.children[0].textContent = date;
        row.children[1].textContent = typeof record.rainfallMm === 'number'
            ? record.rainfallMm.toLocaleString('hr-HR') + ' mm'
            : (record.rainfallMm || 'NEPOZNATO');
        row.children[2].textContent = record.openMeteoRainfallMm == null
            ? '-'
            : Number(record.openMeteoRainfallMm).toLocaleString('hr-HR') + ' mm';
        row.children[3].textContent = record.maxTemperatureC == null
            ? '-'
            : Number(record.maxTemperatureC).toLocaleString('hr-HR') + ' °C';
        row.children[4].textContent = Number(record.heatPoints || 0).toLocaleString('hr-HR', {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
        });
        row.children[5].textContent = record.rainfallStatus === 'unknown'
            ? 'nema arhive'
            : (record.stationReported ? 'izmjereno' : 'računa se 0');
        historyEl.appendChild(row);
    });
}

var WEATHER_DAY_NAMES = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];

function weatherDate(value) {
    var date = new Date(value + 'T12:00:00');
    return isNaN(date.getTime()) ? null : date;
}

function weatherDateKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function weatherDateLabel(date) {
    return date.getDate() + '. ' + (date.getMonth() + 1) + '. ' + date.getFullYear() + '. (' + WEATHER_DAY_NAMES[date.getDay()] + ')';
}

function weatherHeatPoints(temperature) {
    if (temperature == null || temperature <= 25) return 0;
    if (temperature <= 30) return Math.round((temperature - 25) * 0.2 * 10) / 10;
    return Math.round(Math.min(2, 1 + (temperature - 30) * 0.1) * 10) / 10;
}

function weatherRainPoints(rainMm) {
    return Math.min(7, rainMm / 2);
}

function weatherRating(score) {
    if (score >= 7) return { label: 'Crveno', className: 'score-red' };
    if (score >= 5) return { label: 'Narančasto', className: 'score-orange' };
    if (score >= 3) return { label: 'Žuto', className: 'score-yellow' };
    return { label: 'Zeleno', className: 'score-green' };
}

function weatherScoreResult(days) {
    var heat = days.reduce(function (sum, day) { return sum + Number(day.heatPoints || weatherHeatPoints(day.maxTemperatureC)); }, 0);
    var rain = days.reduce(function (sum, day) {
        if (day.rainfallKnown) return sum + day.rainfallMm;
        if (Number.isFinite(day.openMeteoRainfallMm)) return sum + day.openMeteoRainfallMm;
        return sum + (typeof day.rainfallMm === 'number' ? day.rainfallMm : 0);
    }, 0);
    var score = Math.max(0, heat - weatherRainPoints(rain));
    return { heat: heat, rain: rain, score: score, rating: weatherRating(score) };
}

function renderScoreResult(container, result) {
    if (!container) return;
    var isCollapsed = container.classList.contains('collapsed');
    container.className = 'weather-score-result ' + result.rating.className + (isCollapsed ? ' collapsed' : '');
    var card = container.closest('.weather-score-card');
    var swatches = card ? card.querySelectorAll('.weather-score-swatch') : [];
    swatches.forEach(function (swatch) {
        swatch.className = 'weather-score-swatch ' + result.rating.className;
    });
    container.textContent = result.rating.label + ' | ' + result.score.toLocaleString('hr-HR', { maximumFractionDigits: 1 })
        + ' bod. | vrućina ' + result.heat.toLocaleString('hr-HR', { maximumFractionDigits: 1 })
        + ' | kiša ' + result.rain.toLocaleString('hr-HR', { maximumFractionDigits: 1 }) + ' mm';
}

function renderWeatherScores(data) {
    var history = (data.rainfallHistory || []).map(function (record) {
        var date = weatherDate(record.observationDate || (record.recordedAt || '').slice(0, 10));
        return date ? {
            date: date,
            key: weatherDateKey(date),
            rainfallMm: Number(record.rainfallMm || 0),
            openMeteoRainfallMm: Number(record.openMeteoRainfallMm || 0),
            rainfallKnown: typeof record.rainfallMm === 'number',
            maxTemperatureC: record.maxTemperatureC == null ? null : Number(record.maxTemperatureC),
            heatPoints: record.heatPoints == null ? null : Number(record.heatPoints)
        } : null;
    }).filter(Boolean);
    var today = new Date();
    today.setHours(12, 0, 0, 0);
    var todayKey = weatherDateKey(today);
    var pastDays = history.filter(function (day) {
        var age = Math.round((today - day.date) / 86400000);
        return age >= 0 && age < 7;
    });
    var futureDays = (data.forecast || []).map(function (day, index) {
        var dateMatch = (day.date || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
        var date = dateMatch ? weatherDate(dateMatch[3] + '-' + dateMatch[2] + '-' + dateMatch[1]) : null;
        if (!date) { date = new Date(today); date.setDate(today.getDate() + index); }
        var rainMatch = (day.precipitation || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
        return {
            date: date,
            rainfallMm: rainMatch ? Number(rainMatch[0]) : 0,
            maxTemperatureC: day.maxTemperatureC,
            heatPoints: day.heatPoints
        };
    }).filter(function (day) {
        var age = Math.round((day.date - today) / 86400000);
        return age >= 0 && age < 7;
    });
    renderScoreResult(document.querySelector('#weather-score-past .weather-score-result'), weatherScoreResult(pastDays));
    renderScoreResult(document.querySelector('#weather-score-future .weather-score-result'), weatherScoreResult(futureDays));

    var weeks = {};
    history.forEach(function (day) {
        var monday = new Date(day.date);
        var offset = (monday.getDay() + 6) % 7;
        monday.setDate(monday.getDate() - offset);
        var key = weatherDateKey(monday);
        if (!weeks[key]) weeks[key] = { start: monday, days: [] };
        weeks[key].days.push(day);
    });
    var weekList = document.querySelector('#weather-score-calendar .weather-score-list');
    if (!weekList) return;
    weekList.innerHTML = '';
    Object.keys(weeks).sort().reverse().slice(0, 8).forEach(function (key) {
        var week = weeks[key];
        var result = weatherScoreResult(week.days);
        var end = new Date(week.start);
        end.setDate(end.getDate() + 6);
        var row = document.createElement('div');
        row.className = 'weather-week-row ' + result.rating.className;
        row.textContent = weatherDateLabel(week.start) + ' - ' + weatherDateLabel(end)
            + ': ' + result.rating.label + ' (' + result.score.toLocaleString('hr-HR', { maximumFractionDigits: 1 }) + ' bod.)';
        weekList.appendChild(row);
    });
}

function loadWeather() {
    fetch('data/weather.json?v=' + Date.now())
        .then(function (response) {
            if (!response.ok) throw new Error('Nema data/weather.json');
            return response.json();
        })
        .then(renderWeather)
        .catch(function (error) {
            var statusEl = document.getElementById('weather-status');
            if (statusEl) statusEl.textContent = 'Vremenski podaci nisu dostupni: ' + error.message;
        });
}

loadWeather();

document.querySelectorAll('.weather-section-toggle').forEach(function (toggleEl) {
    var cardEl = toggleEl.closest('.weather-score-card');
    var contentEl = cardEl ? cardEl.querySelector('.weather-score-list, .weather-score-result') : null;
    if (!contentEl) return;
    contentEl.classList.add('collapsed');
    toggleEl.addEventListener('click', function () {
        var isCollapsed = contentEl.classList.toggle('collapsed');
        toggleEl.setAttribute('aria-expanded', String(!isCollapsed));
    });
});

var weatherPanelEl = document.getElementById('weather-panel');
var openWeatherEl = document.getElementById('open-weather');
var closeWeatherEl = document.getElementById('close-weather');
if (weatherPanelEl && openWeatherEl && closeWeatherEl) {
    weatherPanelEl.classList.add('hidden');
    openWeatherEl.addEventListener('click', function () {
        weatherPanelEl.classList.remove('hidden');
        weatherPanelEl.classList.add('weather-open');
    });
    closeWeatherEl.addEventListener('click', function () {
        weatherPanelEl.classList.remove('weather-open');
        weatherPanelEl.classList.add('hidden');
    });
}

document.getElementById('zoom-in').addEventListener('click', function () { map.zoomIn(); });
document.getElementById('zoom-out').addEventListener('click', function () { map.zoomOut(); });

var noteInputEl = document.getElementById('status-napomena');
if (noteInputEl) {
    noteInputEl.addEventListener('focus', function () {
        if (canEdit()) noteInputEl.removeAttribute('readonly');
    });
    noteInputEl.addEventListener('click', function () {
        if (canEdit()) noteInputEl.removeAttribute('readonly');
    });
    noteInputEl.addEventListener('input', function () {
        queuePlantPanelAutosave();
    });
    noteInputEl.addEventListener('blur', function () {
        flushPlantPanelAutosave();
    });
    noteInputEl.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        flushPlantPanelAutosave();
    });
}

var sprayInputEl = document.getElementById('status-spricano');
if (sprayInputEl) {
    sprayInputEl.addEventListener('input', function () {
        queuePlantPanelAutosave();
    });
    sprayInputEl.addEventListener('blur', function () {
        flushPlantPanelAutosave();
    });
}

var pruneSelectEl = document.getElementById('status-orezano');
if (pruneSelectEl) {
    pruneSelectEl.addEventListener('change', function () {
        flushPlantPanelAutosave();
    });
}

var fertilizeSelectEl = document.getElementById('status-gnojeno');
if (fertilizeSelectEl) {
    fertilizeSelectEl.addEventListener('change', function () {
        flushPlantPanelAutosave();
    });
}

var savePlantBtn = document.getElementById('save-plant-status');
if (savePlantBtn) {
    savePlantBtn.addEventListener('click', saveSelectedPlantPanel);
}

var plantPanelEl = document.getElementById('plant-panel');
var togglePlantPanelBtn = document.getElementById('toggle-plant-panel');

if (plantPanelEl && togglePlantPanelBtn) {
    togglePlantPanelBtn.addEventListener('click', function () {
        var minimized = plantPanelEl.classList.toggle('minimized');
        togglePlantPanelBtn.textContent = minimized ? '+' : 'x';
        togglePlantPanelBtn.title = minimized ? 'Prikaži panel' : 'Minimiziraj panel';
    });
}

var toggleChangesBtn = document.getElementById('toggle-changes');
var changesModal = document.getElementById('changes-modal');
var closeChangesModalBtn = document.getElementById('close-changes-modal');
var openYieldTableBtn = document.getElementById('open-yield-table');
var yieldModal = document.getElementById('yield-modal');
var closeYieldModalBtn = document.getElementById('close-yield-modal');

function openChangesModal() {
    if (!changesModal) return;
    renderChangeList();
    changesModal.classList.remove('hidden');
    if (toggleChangesBtn) toggleChangesBtn.classList.add('active');
}

function closeChangesModal() {
    if (!changesModal) return;
    changesModal.classList.add('hidden');
    if (toggleChangesBtn) toggleChangesBtn.classList.remove('active');
}

if (toggleChangesBtn && changesModal) {
    toggleChangesBtn.addEventListener('click', function () {
        if (changesModal.classList.contains('hidden')) openChangesModal();
        else closeChangesModal();
    });
}

if (closeChangesModalBtn) {
    closeChangesModalBtn.addEventListener('click', closeChangesModal);
}

if (changesModal) {
    changesModal.addEventListener('click', function (event) {
        if (event.target === changesModal) closeChangesModal();
    });
}

function openYieldModal() {
    if (!yieldModal) return;
    renderYieldTable();
    yieldModal.classList.remove('hidden');
}

function closeYieldModal() {
    if (!yieldModal) return;
    yieldModal.classList.add('hidden');
}

if (openYieldTableBtn) {
    openYieldTableBtn.addEventListener('click', openYieldModal);
}

if (closeYieldModalBtn) {
    closeYieldModalBtn.addEventListener('click', closeYieldModal);
}

if (yieldModal) {
    yieldModal.addEventListener('click', function (event) {
        if (event.target === yieldModal) closeYieldModal();
    });
}

var changeListEl = document.getElementById('tree-list-items');
if (changeListEl) {
    changeListEl.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.classList) return;
        var id = target.getAttribute('data-id');
        if (!id || !canEdit()) return;

        if (target.classList.contains('remove-tree')) {
            removeUserItem(id);
            return;
        }

        if (target.classList.contains('remove-detail')) {
            var kind = target.getAttribute('data-kind') || '';
            if (kind === 'position') {
                clearBaseItemPosition(id);
            } else {
                clearBaseItemChanges(id);
            }
        }
    });
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeChangesModal();
        closeYieldModal();
        setMenuOpen(false);
        closeAddTreeModal();
        closeEncyclopedia();
        closeTasks();
        setPlacementEnabled(false);
        return;
    }

    // Dok se piše u polje (forma, napomena, prijava), tipke ne pomiču kartu.
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === '+' || e.key === '=' || e.code === 'Equal') {
        map.zoomIn();
    } else if (e.key === '-' || e.key === '_' || e.code === 'Minus') {
        map.zoomOut();
    } else if (e.key === 'ArrowLeft') {
        map.panBy([-20, 0]);
        e.preventDefault();
    } else if (e.key === 'ArrowRight') {
        map.panBy([20, 0]);
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        map.panBy([0, -20]);
        e.preventDefault();
    } else if (e.key === 'ArrowDown') {
        map.panBy([0, 20]);
        e.preventDefault();
    }
});

var exportBtn = document.getElementById('export-json');
if (exportBtn) {
    exportBtn.addEventListener('click', downloadJson);
}

var exportBackupBtn = document.getElementById('export-backup');
if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', downloadChangesBackup);
}

var importBackupBtn = document.getElementById('import-backup');
var importBackupInput = document.getElementById('import-backup-file');
if (importBackupBtn && importBackupInput) {
    importBackupBtn.addEventListener('click', function () {
        importBackupInput.value = '';
        importBackupInput.click();
    });
    importBackupInput.addEventListener('change', function () {
        if (importBackupInput.files && importBackupInput.files[0]) {
            importChangesBackup(importBackupInput.files[0]);
        }
    });
}

var toggleWaterFilterBtn = document.getElementById('toggle-water-filter');
if (toggleWaterFilterBtn) {
    toggleWaterFilterBtn.addEventListener('click', function () {
        waterFilterEnabled = !waterFilterEnabled;
        toggleWaterFilterBtn.textContent = waterFilterEnabled ? '💧 Prikaz zalijevanja uključen' : '💧 Prikaz zalijevanja';
        toggleWaterFilterBtn.classList.toggle('water-filter-active', waterFilterEnabled);
        toggleWaterFilterBtn.classList.toggle('water-filter-inactive', !waterFilterEnabled);
        refreshAllMarkerIcons();
    });
}

// ---------------------------------------------------------------------------
// Dodavanje stabla: prozor s podacima -> klik na kartu postavlja stablo
// ---------------------------------------------------------------------------
var addTreeModal = document.getElementById('add-tree-modal');
var addTreeForm = document.getElementById('add-tree-form');
var addTreeErrorEl = document.getElementById('add-tree-error');
var placementHintEl = document.getElementById('placement-hint');
var cursorTreeEl = document.getElementById('cursor-tree');
var pendingNewTree = null;

function treeEmoji(type) {
    var label = getTypeWithEmoji(type);
    var idx = label.indexOf(' ');
    return idx === -1 ? '🌳' : label.slice(idx + 1);
}

function showAddTreeError(message) {
    if (!addTreeErrorEl) return;
    addTreeErrorEl.textContent = message || '';
    addTreeErrorEl.classList.toggle('hidden', !message);
}

function openAddTreeModal() {
    if (!canEdit() || !addTreeModal) return;
    setPlacementEnabled(false);
    setDragEnabled(false);
    addTreeForm.reset();
    showAddTreeError('');
    var optional = addTreeForm.querySelector('details');
    if (optional) optional.open = false;
    addTreeModal.classList.remove('hidden');
    document.getElementById('new-tree-type').focus();
}

function closeAddTreeModal() {
    if (addTreeModal) addTreeModal.classList.add('hidden');
}

function readNewTreeForm() {
    var type = document.getElementById('new-tree-type').value;
    var name = document.getElementById('new-tree-name').value.trim();
    if (!type) return { error: 'Odaberi vrstu stabla.', focus: 'new-tree-type' };
    if (!name) return { error: 'Upiši ime / oznaku stabla.', focus: 'new-tree-name' };

    var heightRaw = document.getElementById('new-tree-height').value;
    var height = heightRaw === '' ? null : Number(heightRaw);
    if (height !== null && (!isFinite(height) || height < 0)) {
        return { error: 'Visina mora biti broj (npr. 2.5).', focus: 'new-tree-height' };
    }

    return {
        tree: {
            type: normalizeType(type),
            name: name,
            heightM: height,
            growthStage: document.getElementById('new-tree-stage').value,
            canopyDensity: document.getElementById('new-tree-density').value,
            notes: document.getElementById('new-tree-notes').value.trim(),
            orezano: document.getElementById('new-tree-orezano').value,
            gnojeno: document.getElementById('new-tree-gnojeno').value,
            spricano: document.getElementById('new-tree-spricano').value.trim()
        }
    };
}

function moveCursorTree(event) {
    if (!cursorTreeEl || !pendingNewTree) return;
    cursorTreeEl.style.left = event.clientX + 'px';
    cursorTreeEl.style.top = event.clientY + 'px';
    cursorTreeEl.classList.remove('hidden');
}

function setPlacementEnabled(enabled) {
    placementEnabled = !!enabled && canEdit() && !!pendingNewTree;
    if (!placementEnabled) pendingNewTree = null;

    document.body.classList.toggle('placing-tree', placementEnabled);
    if (placementHintEl) placementHintEl.classList.toggle('hidden', !placementEnabled);
    if (!placementEnabled && cursorTreeEl) cursorTreeEl.classList.add('hidden');

    if (placementEnabled) {
        document.addEventListener('mousemove', moveCursorTree);
    } else {
        document.removeEventListener('mousemove', moveCursorTree);
    }
}

function startPlacement(tree) {
    pendingNewTree = tree;
    var icon = iconByType(tree.type);
    if (cursorTreeEl) {
        cursorTreeEl.innerHTML = icon
            ? '<img src="' + icon + '" alt="">'
            : '<span>' + treeEmoji(tree.type) + '</span>';
        cursorTreeEl.classList.add('hidden');
    }
    var hintText = document.getElementById('placement-hint-text');
    if (hintText) {
        var isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        hintText.textContent = treeEmoji(tree.type) + (isTouch ? ' Dodirni kartu gdje želiš postaviti: ' : ' Klikni na kartu gdje želiš postaviti: ') + tree.name;
        var cancelBtnEl = document.getElementById('cancel-placement');
        if (cancelBtnEl) cancelBtnEl.textContent = isTouch ? 'Odustani' : 'Odustani (Esc)';
    }
    setPlacementEnabled(true);
}

function placePendingTree(latlng) {
    var tree = pendingNewTree;
    if (!tree) return;

    var newItem = {
        id: tree.type + String(nextGlobalIdNumber()).padStart(3, '0'),
        name: tree.name,
        treeType: tree.type,
        lat: latlng.lat,
        lng: latlng.lng,
        notes: tree.notes,
        iconUrl: iconByType(tree.type)
    };
    if (tree.heightM !== null) newItem.heightM = tree.heightM;
    if (tree.growthStage) newItem.growthStage = tree.growthStage;
    if (tree.canopyDensity) newItem.canopyDensity = tree.canopyDensity;

    userItems.push(newItem);
    allItemsById[newItem.id] = newItem;
    saveUserItems();

    if (tree.orezano !== 'nepoznato' || tree.gnojeno !== 'nepoznato' || tree.spricano) {
        plantDetails[newItem.id] = {
            orezano: tree.orezano,
            gnojeno: tree.gnojeno,
            spricano: tree.spricano,
            napomena: tree.notes
        };
        savePlantDetails();
    }

    createMarker(newItem, { isUserItem: true });
    renderChangeList();
    setPlacementEnabled(false);
    openPlantPanel(newItem, true);
}

if (addTreeForm) {
    document.getElementById('open-add-tree').addEventListener('click', function () {
        setMenuOpen(false);
        openAddTreeModal();
    });
    document.getElementById('close-add-tree').addEventListener('click', closeAddTreeModal);
    document.getElementById('cancel-add-tree').addEventListener('click', closeAddTreeModal);
    addTreeModal.addEventListener('click', function (event) {
        if (event.target === addTreeModal) closeAddTreeModal();
    });
    addTreeForm.addEventListener('input', function () { showAddTreeError(''); });
    addTreeForm.addEventListener('change', function () { showAddTreeError(''); });
    addTreeForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var result = readNewTreeForm();
        if (result.error) {
            showAddTreeError(result.error);
            var field = document.getElementById(result.focus);
            if (field) {
                if (result.focus === 'new-tree-height') field.closest('details').open = true;
                field.focus();
            }
            return;
        }
        closeAddTreeModal();
        startPlacement(result.tree);
    });
}

var cancelPlacementBtn = document.getElementById('cancel-placement');
if (cancelPlacementBtn) {
    cancelPlacementBtn.addEventListener('click', function () { setPlacementEnabled(false); });
}

// ---------------------------------------------------------------------------
// Premještanje stabala (povlačenje markera)
// ---------------------------------------------------------------------------
var toggleDragBtn = document.getElementById('toggle-drag');
if (toggleDragBtn) {
    toggleDragBtn.addEventListener('click', function () {
        setDragEnabled(!dragEnabled);
    });
}

function setDragEnabled(enabled) {
    dragEnabled = !!enabled && canEdit();
    if (dragEnabled) setPlacementEnabled(false);
    Object.keys(allMarkersById).forEach(function (id) {
        var marker = allMarkersById[id];
        if (!marker.dragging) return;
        if (dragEnabled) marker.dragging.enable();
        else marker.dragging.disable();
    });

    if (toggleDragBtn) {
        toggleDragBtn.textContent = dragEnabled ? '✅ Premještanje uključeno' : '✋ Premjesti stablo';
        toggleDragBtn.classList.toggle('active', dragEnabled);
        toggleDragBtn.setAttribute('aria-pressed', dragEnabled ? 'true' : 'false');
    }
}

// Klik na mapu: postavi stablo iz prozora "Dodaj stablo"
map.on('click', function (e) {
    if (!placementEnabled || !canEdit() || !pendingNewTree) {
        // Klik na prazan dio karte poništava odabir stabla
        if (selectedPlant) {
            flushPlantPanelAutosave();
            closePlantPanelSelection();
        }
        return;
    }
    placePendingTree(e.latlng);
});

// ---------------------------------------------------------------------------
// Izbornik (☰)
// ---------------------------------------------------------------------------
var toggleMenuBtn = document.getElementById('toggle-menu');
var sideMenuEl = document.getElementById('side-menu');

function setMenuOpen(open) {
    if (!sideMenuEl || !toggleMenuBtn) return;
    sideMenuEl.classList.toggle('hidden', !open);
    toggleMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

if (toggleMenuBtn && sideMenuEl) {
    toggleMenuBtn.addEventListener('click', function () {
        setMenuOpen(sideMenuEl.classList.contains('hidden'));
    });
    ['open-weather', 'open-yield-table', 'toggle-changes'].forEach(function (id) {
        var btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', function () { setMenuOpen(false); });
    });
}

// ---------------------------------------------------------------------------
// Admin prijava
// ---------------------------------------------------------------------------
function fetchAdminStatus() {
    return fetch(AUTH_API_URL, { cache: 'no-store' })
        .then(function (response) {
            var contentType = response.headers.get('content-type') || '';
            if (!response.ok || contentType.indexOf('application/json') === -1) return false;
            return response.json().then(function (body) { return !!(body && body.admin); });
        })
        .catch(function () { return false; });
}

function updatePlantFormEditable() {
    var editable = canEdit();
    ['status-orezano', 'status-gnojeno'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.disabled = !editable;
    });
    var spray = document.getElementById('status-spricano');
    if (spray) {
        spray.readOnly = !editable;
        spray.placeholder = editable ? 'Primjer: da, modro ulje 4.3.2025' : '';
    }
    var note = document.getElementById('status-napomena');
    if (note) {
        note.setAttribute('readonly', 'readonly');
        note.placeholder = editable ? 'Klikni ovdje za unos napomene' : '';
    }
}

function setAdminMode(admin) {
    isAdminUser = !!admin;
    document.body.classList.toggle('is-admin', canEdit());

    var form = document.getElementById('login-form');
    var toggle = document.getElementById('login-toggle');
    var status = document.getElementById('login-status');
    if (toggle) toggle.classList.toggle('hidden', isAdminUser);
    if (status) status.classList.toggle('hidden', !isAdminUser);
    if (form && isAdminUser) {
        form.classList.add('hidden');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    if (!canEdit()) {
        setPlacementEnabled(false);
        setDragEnabled(false);
    }
    updatePlantFormEditable();
}

var loginToggleBtn = document.getElementById('login-toggle');
var loginFormEl = document.getElementById('login-form');
var loginErrorEl = document.getElementById('login-error');
var logoutBtn = document.getElementById('logout-btn');

function showLoginError(message) {
    if (!loginErrorEl) return;
    loginErrorEl.textContent = message || '';
    loginErrorEl.classList.toggle('hidden', !message);
}

if (loginToggleBtn && loginFormEl) {
    loginToggleBtn.addEventListener('click', function () {
        var open = loginFormEl.classList.contains('hidden');
        loginFormEl.classList.toggle('hidden', !open);
        loginToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        showLoginError('');
        if (open) document.getElementById('login-username').focus();
    });

    loginFormEl.addEventListener('submit', function (event) {
        event.preventDefault();
        var submitBtn = document.getElementById('login-submit');
        var passwordEl = document.getElementById('login-password');
        showLoginError('');
        if (submitBtn) submitBtn.disabled = true;

        fetch(AUTH_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: document.getElementById('login-username').value,
                password: passwordEl.value
            })
        })
            .then(function (response) {
                return response.json().catch(function () { return {}; }).then(function (body) {
                    if (!response.ok) throw new Error(body.error || 'Prijava nije uspjela.');
                    return body;
                });
            })
            .then(function () {
                passwordEl.value = '';
                setAdminMode(true);
                setSyncStatus('ok');
            })
            .catch(function (error) {
                showLoginError(error.message);
            })
            .then(function () {
                if (submitBtn) submitBtn.disabled = false;
            });
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
        if (hasUnsavedChanges()) {
            flushServerSync(false);
            alert('Još se spremaju izmjene, pokušaj odjavu za par sekundi.');
            return;
        }
        fetch(AUTH_API_URL, { method: 'DELETE' })
            .catch(function () {})
            .then(function () { setAdminMode(false); });
    });
}

// ---------------------------------------------------------------------------
// Potvrdni prozor ("Jesi li siguran?")
// ---------------------------------------------------------------------------
var confirmModalEl = document.getElementById('confirm-modal');

function askConfirm(title, message, okLabel) {
    return new Promise(function (resolve) {
        if (!confirmModalEl) {
            resolve(window.confirm(message));
            return;
        }
        var okBtn = document.getElementById('confirm-ok');
        var cancelBtn = document.getElementById('confirm-cancel');
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').textContent = message;
        okBtn.textContent = okLabel || 'U redu';

        function finish(result) {
            confirmModalEl.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            confirmModalEl.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey, true);
            resolve(result);
        }
        function onOk() { finish(true); }
        function onCancel() { finish(false); }
        function onBackdrop(event) { if (event.target === confirmModalEl) finish(false); }
        function onKey(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish(false);
            }
        }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        confirmModalEl.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey, true);
        confirmModalEl.classList.remove('hidden');
        cancelBtn.focus();
    });
}

// ---------------------------------------------------------------------------
// Brisanje stabla
// Originalna stabla se samo označe kao izbrisana (mogu se vratiti),
// dodana stabla se brišu iz baze. Sve ostaje zapisano u povijesti izmjena.
// ---------------------------------------------------------------------------
function closePlantPanelSelection() {
    selectedPlant = null;
    highlightSelectedMarker();
    var emptyEl = document.getElementById('plant-empty');
    var formEl = document.getElementById('plant-form');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (formEl) formEl.classList.add('hidden');
}

function deleteTree(itemId) {
    var item = allItemsById[itemId];
    if (!item || !canEdit()) return;

    var isUserItem = userItems.some(function (u) { return u.id === itemId; });
    if (isUserItem) {
        removeUserItem(itemId);
    } else {
        deletedIds[itemId] = {
            deletedAt: new Date().toISOString(),
            name: item.name || '',
            treeType: item.treeType || ''
        };
        saveDeletedIds();

        var marker = allMarkersById[itemId];
        if (marker) map.removeLayer(marker);
        delete allMarkersById[itemId];
        delete allItemsById[itemId];
        baseItems = baseItems.filter(function (b) { return b.id !== itemId; });
    }

    closePlantPanelSelection();
    renderChangeList();
}

function saveDeletedIds() {
    if (storageMode === 'server') queueServerSync('deleted', deletedIds);
}

var deleteTreeBtn = document.getElementById('delete-tree');
if (deleteTreeBtn) {
    deleteTreeBtn.addEventListener('click', function () {
        if (!selectedPlant || !canEdit()) return;
        if (storageMode !== 'server') {
            alert('Brisanje radi samo na Vercel verziji stranice.');
            return;
        }
        var item = allItemsById[selectedPlant.itemId];
        if (!item) return;
        var itemId = item.id;

        // Prvo spremi eventualne nespremljene izmjene u formi.
        flushPlantPanelAutosave();

        askConfirm(
            'Izbrisati stablo?',
            'Jesi li siguran da želiš izbrisati "' + (item.name || itemId) + '" (' + getTypeWithEmoji(item.treeType) + ', ID ' + itemId + ')? Stablo će nestati s karte.',
            '🗑️ Izbriši'
        ).then(function (ok) {
            if (ok) deleteTree(itemId);
        });
    });
}

// ---------------------------------------------------------------------------
// Enciklopedija vrsta (podaci u data/enciklopedija.json)
// ---------------------------------------------------------------------------
var encyclopediaModal = document.getElementById('encyclopedia-modal');
var encyclopediaListEl = document.getElementById('encyclopedia-list');
var encyclopediaArticleEl = document.getElementById('encyclopedia-article');
var encyclopediaData = null;
var encyclopediaLoading = null;
var encyclopediaSelectedId = null;

function loadEncyclopedia() {
    if (encyclopediaData) return Promise.resolve(encyclopediaData);
    if (!encyclopediaLoading) {
        encyclopediaLoading = fetchJsonFile('data/enciklopedija.json?v=20261121a')
            .then(function (data) {
                encyclopediaData = data;
                return data;
            })
            .catch(function (error) {
                encyclopediaLoading = null;
                throw error;
            });
    }
    return encyclopediaLoading;
}

function countTreesByType() {
    var counts = {};
    baseItems.concat(userItems).forEach(function (item) {
        var t = normalizeType(item.treeType);
        counts[t] = (counts[t] || 0) + 1;
    });
    return counts;
}

function encyclopediaIconHtml(entry, size) {
    var icon = iconByType(entry.id);
    if (icon) {
        return '<img src="' + icon + '" alt="" width="' + size + '" height="' + size + '">';
    }
    return '<span class="enc-emoji" style="font-size:' + Math.round(size * 0.8) + 'px">' + escapeHtml(entry.emoji || '🌳') + '</span>';
}

function waterDropsHtml(typeId) {
    var t = normalizeType(typeId);
    var level = WATER_NEED_LEVEL[t] !== undefined ? WATER_NEED_LEVEL[t] : WATER_NEED_LEVEL._default;
    var drops = '';
    for (var i = 0; i < 4; i++) {
        drops += i < level ? '💧' : '<span class="drop-off">💧</span>';
    }
    return '<span class="enc-drops" title="Potreba za vodom: ' + level + '/4">' + drops + '</span> <small>(' + level + '/4)</small>';
}

function renderEncyclopediaList() {
    if (encyclopediaMode === 'povrce') { renderVegList(); return; }
    if (!encyclopediaData || !encyclopediaListEl) return;
    var counts = countTreesByType();
    encyclopediaListEl.innerHTML = encyclopediaData.vrste.map(function (entry) {
        var count = counts[entry.id] || 0;
        var active = entry.id === encyclopediaSelectedId;
        return '<button type="button" class="enc-item' + (active ? ' active' : '') + '" data-id="' + escapeHtml(entry.id) + '"' +
            (active ? ' aria-current="true"' : '') + '>' +
            encyclopediaIconHtml(entry, 22) +
            '<span class="enc-item-name">' + escapeHtml(entry.naziv) + '</span>' +
            (count ? '<span class="enc-count" title="Na karti">' + count + '</span>' : '') +
            '</button>';
    }).join('');
}

function listHtml(items) {
    if (!items || !items.length) return '<p class="enc-muted">Nema posebnih napomena.</p>';
    return '<ul class="enc-list">' + items.map(function (it) {
        return '<li><b>' + escapeHtml(it.naziv) + '</b> – ' + escapeHtml(it.opis) + '</li>';
    }).join('') + '</ul>';
}

function renderEncyclopediaArticle() {
    if (encyclopediaMode === 'povrce') { renderVegArticle(); return; }
    if (!encyclopediaData || !encyclopediaArticleEl) return;
    var entry = encyclopediaData.vrste.find(function (v) { return v.id === encyclopediaSelectedId; });
    if (!entry) {
        encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Odaberi vrstu s popisa.</p>';
        return;
    }

    var count = countTreesByType()[entry.id] || 0;
    var html = '';
    html += '<header class="enc-head">' + encyclopediaIconHtml(entry, 44) +
        '<div><h2>' + escapeHtml(entry.naziv) + '</h2>' +
        (entry.latinski ? '<i class="enc-latin">' + escapeHtml(entry.latinski) + '</i>' : '') +
        '<div class="enc-onmap">Na karti: <b>' + count + '</b></div></div></header>';
    html += '<p>' + escapeHtml(entry.opis) + '</p>';

    html += '<section><h3>💧 Voda</h3><p>' + waterDropsHtml(entry.id) + '</p><p>' + escapeHtml(entry.voda) + '</p></section>';

    if (entry.orezivanje) {
        html += '<section><h3>✂️ Orezivanje</h3>' +
            '<p><b>Kada:</b> ' + escapeHtml(entry.orezivanje.kada) + '</p>' +
            '<p><b>Kako:</b> ' + escapeHtml(entry.orezivanje.kako) + '</p></section>';
    }
    if (entry.gnojidba) {
        html += '<section><h3>🌱 Gnojidba</h3><p>' + escapeHtml(entry.gnojidba) + '</p></section>';
    }
    if (entry.bolesti && entry.bolesti.length) {
        html += '<section><h3>🦠 Bolesti</h3>' + listHtml(entry.bolesti) + '</section>';
    }
    if (entry.stetnici && entry.stetnici.length) {
        html += '<section><h3>🐛 Štetnici</h3>' + listHtml(entry.stetnici) + '</section>';
    }
    if (entry.zastita && entry.zastita.length) {
        html += '<section><h3>🧴 Tretmani / zaštita kroz godinu</h3><table class="enc-table"><tbody>' +
            entry.zastita.map(function (z) {
                return '<tr><th scope="row">' + escapeHtml(z.kada) + '</th><td>' + escapeHtml(z.sto) + '</td></tr>';
            }).join('') + '</tbody></table></section>';
    }
    if (entry.berba) {
        html += '<section><h3>🧺 Berba</h3><p>' + escapeHtml(entry.berba) + '</p></section>';
    }
    if (encyclopediaData.meta && encyclopediaData.meta.napomena) {
        html += '<p class="enc-note">ℹ️ ' + escapeHtml(encyclopediaData.meta.napomena) + '</p>';
    }

    encyclopediaArticleEl.innerHTML = html;
    encyclopediaArticleEl.scrollTop = 0;
}

function selectEncyclopediaEntry(id) {
    if (encyclopediaMode === 'povrce') vegSelectedId = id;
    else encyclopediaSelectedId = id;
    renderEncyclopediaList();
    renderEncyclopediaArticle();
}

function openEncyclopedia(typeId) {
    if (!encyclopediaModal) return;
    encyclopediaModal.classList.remove('hidden');
    // S određenom vrstom (npr. "O vrsti") uvijek kartica Voće; inače zadnja korištena kartica.
    if (typeId || encyclopediaMode === 'voce') setEncyclopediaMode('voce');
    else { setEncyclopediaMode('povrce'); return; }
    if (encyclopediaArticleEl && !encyclopediaData) {
        encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Učitavanje...</p>';
    }
    loadEncyclopedia()
        .then(function (data) {
            var wanted = typeId ? normalizeType(typeId) : encyclopediaSelectedId;
            var exists = data.vrste.some(function (v) { return v.id === wanted; });
            selectEncyclopediaEntry(exists ? wanted : data.vrste[0].id);
            var active = encyclopediaListEl && encyclopediaListEl.querySelector('.enc-item.active');
            if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        })
        .catch(function (error) {
            console.error(error);
            if (encyclopediaArticleEl) encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Ne mogu učitati enciklopediju.</p>';
        });
}

function closeEncyclopedia() {
    if (encyclopediaModal) encyclopediaModal.classList.add('hidden');
}

if (encyclopediaModal) {
    document.getElementById('open-encyclopedia').addEventListener('click', function () {
        setMenuOpen(false);
        openEncyclopedia(null);
    });
    document.getElementById('close-encyclopedia').addEventListener('click', closeEncyclopedia);
    encyclopediaModal.addEventListener('click', function (event) {
        if (event.target === encyclopediaModal) closeEncyclopedia();
    });
    encyclopediaListEl.addEventListener('click', function (event) {
        var btn = event.target.closest('.enc-item');
        if (btn) selectEncyclopediaEntry(btn.getAttribute('data-id'));
    });
}

var plantEncyclopediaBtn = document.getElementById('plant-open-encyclopedia');
if (plantEncyclopediaBtn) {
    plantEncyclopediaBtn.addEventListener('click', function () {
        var item = selectedPlant && allItemsById[selectedPlant.itemId];
        openEncyclopedia(item ? item.treeType : null);
    });
}

// ---------------------------------------------------------------------------
// Raspored radova (podaci u data/raspored.json, stanje zadataka u bazi kao 'task')
//
// Stanje zadatka (taskDone[ključ]):
//   { status: 'done' }                       obavljeno
//   { status: 'postponed', to: {year,month} } odgođeno na drugi mjesec
//   { status: 'skipped' }                    preskočeno ove sezone
//   { status: 'done', to: {...} }            odgođeno pa obavljeno
// Stari zapisi { done: true } znače obavljeno.
// ---------------------------------------------------------------------------
var MONTH_NAMES = ['Siječanj', 'Veljača', 'Ožujak', 'Travanj', 'Svibanj', 'Lipanj', 'Srpanj', 'Kolovoz', 'Rujan', 'Listopad', 'Studeni', 'Prosinac'];
var MONTH_NAMES_GEN = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenog', 'prosinca'];
var CATEGORY_ICONS = { orezivanje: '✂️', 'zaštita': '🧴', gnojidba: '🌱', berba: '🧺', voda: '💧', higijena: '🧹', vrijeme: '🌡️', ostalo: '📝' };
var tasksModal = document.getElementById('tasks-modal');
var tasksData = null;
var tasksLoading = null;
var tasksView = null; // { year, month }
var postponingKey = null; // zadatak za koji je otvoren odabir mjeseca

function seasonName(month) {
    if (month === 12 || month <= 2) return '❄️ Zima';
    if (month <= 5) return '🌸 Proljeće';
    if (month <= 8) return '☀️ Ljeto';
    return '🍂 Jesen';
}

function loadTasks() {
    if (tasksData) return Promise.resolve(tasksData);
    if (!tasksLoading) {
        tasksLoading = Promise.all([fetchJsonFile('data/raspored.json?v=20261121a'), loadEncyclopedia().catch(function () { return null; })])
            .then(function (results) {
                tasksData = results[0];
                return tasksData;
            })
            .catch(function (error) {
                tasksLoading = null;
                throw error;
            });
    }
    return tasksLoading;
}

// Zadatak koji prelazi preko Nove godine (npr. studeni–ožujak) pripada sezoni sljedeće godine.
function taskKey(task, year, month) {
    var m = task.mjeseci || [];
    var wraps = m.indexOf(12) !== -1 && m.indexOf(1) !== -1;
    var seasonYear = wraps && month >= 9 ? year + 1 : year;
    return seasonYear + ':' + task.id;
}

function taskIdFromKey(key) {
    return String(key).slice(String(key).indexOf(':') + 1);
}

function getTaskState(key) {
    var s = taskDone[key];
    if (!s) return null;
    if (!s.status && s.done) return { status: 'done', at: s.at };
    return s;
}

function sameMonth(to, year, month) {
    return !!to && to.year === year && to.month === month;
}

function monthLabel(to) {
    return MONTH_NAMES[to.month - 1] + ' ' + to.year;
}

function speciesName(typeId) {
    if (encyclopediaData) {
        var entry = encyclopediaData.vrste.find(function (v) { return v.id === typeId; });
        if (entry) return entry.naziv;
    }
    return typeId;
}

function speciesIconHtml(typeId) {
    var icon = iconByType(typeId);
    if (icon) return '<img src="' + icon + '" alt="" width="16" height="16">';
    var emoji = '🌳';
    if (encyclopediaData) {
        var entry = encyclopediaData.vrste.find(function (v) { return v.id === typeId; });
        if (entry && entry.emoji) emoji = entry.emoji;
    }
    return '<span>' + emoji + '</span>';
}

function buildTaskRow(task, key, counts, month, movedHere) {
    var species = (task.vrste || []).filter(function (v) { return counts[v] > 0; });
    if (task.vrste && task.vrste.length && !species.length) return null;
    var m = task.mjeseci || [];
    var state = getTaskState(key);
    return {
        task: task,
        key: key,
        species: species,
        trees: species.reduce(function (sum, v) { return sum + counts[v]; }, 0),
        state: state,
        done: !!state && state.status === 'done',
        movedHere: !!movedHere,
        isLast: !movedHere && m.length > 1 && m[m.length - 1] === month,
        isFirst: !movedHere && m.length > 1 && m[0] === month
    };
}

// Vraća { active: [...], away: [...] }: aktivni zadaci ovog mjeseca i oni odgođeni/preskočeni.
function tasksForView() {
    var counts = countTreesByType();
    var year = tasksView.year;
    var month = tasksView.month;
    var active = [];
    var away = [];
    var seen = {};

    tasksData.zadaci.forEach(function (task) {
        if ((task.mjeseci || []).indexOf(month) === -1) return;
        var key = taskKey(task, year, month);
        var row = buildTaskRow(task, key, counts, month, false);
        if (!row) return;
        seen[key] = true;
        var s = row.state;
        if (s && s.status === 'skipped') {
            away.push(row);
        } else if (s && s.to && !sameMonth(s.to, year, month)) {
            away.push(row); // odgođeno na drugi mjesec
        } else {
            if (s && s.to) row.movedHere = true;
            active.push(row);
        }
    });

    // Zadaci odgođeni na ovaj mjesec iz nekog drugog
    Object.keys(taskDone).forEach(function (key) {
        if (seen[key]) return;
        var s = getTaskState(key);
        if (!s || !sameMonth(s.to, year, month)) return;
        var task = tasksData.zadaci.find(function (t) { return t.id === taskIdFromKey(key); });
        if (!task) return;
        var row = buildTaskRow(task, key, counts, month, true);
        if (row) active.push(row);
    });

    return { active: active, away: away };
}

function postponeOptions(key) {
    // Sljedećih 6 mjeseci od mjeseca koji se gleda
    var html = '';
    for (var i = 1; i <= 6; i++) {
        var m = tasksView.month + i;
        var y = tasksView.year;
        while (m > 12) { m -= 12; y += 1; }
        html += '<option value="' + y + '-' + m + '">' + MONTH_NAMES[m - 1] + ' ' + y + '</option>';
    }
    return html;
}

function taskActionsHtml(r, editable) {
    if (!editable || r.done) return '';
    if (postponingKey === r.key) {
        return '<div class="task-actions postpone-picker">' +
            '<label>Odgodi na: <select class="postpone-month" data-key="' + escapeHtml(r.key) + '">' + postponeOptions(r.key) + '</select></label>' +
            '<button type="button" class="task-act primary" data-act="postpone-ok" data-key="' + escapeHtml(r.key) + '">Odgodi</button>' +
            '<button type="button" class="task-act" data-act="postpone-cancel">Odustani</button>' +
            '</div>';
    }
    return '<div class="task-actions">' +
        '<button type="button" class="task-act" data-act="postpone" data-key="' + escapeHtml(r.key) + '">⏭️ Odgodi</button>' +
        '<button type="button" class="task-act" data-act="skip" data-key="' + escapeHtml(r.key) + '">🚫 Preskoči ove sezone</button>' +
        '</div>';
}

function taskRowHtml(r, editable) {
    var t = r.task;
    var badges = '';
    if (r.movedHere && r.state && r.state.from) {
        badges += '<span class="task-badge moved">↪ odgođeno iz ' + escapeHtml(MONTH_NAMES_GEN[r.state.from.month - 1]) + '</span>';
    } else if (r.movedHere) {
        badges += '<span class="task-badge moved">↪ odgođeno</span>';
    }
    if (r.isLast && !r.done) badges += '<span class="task-badge last">⏳ zadnji mjesec</span>';
    if (t.poPotrebi && !r.done) badges += '<span class="task-badge cond" title="Napraviti samo ako je problem prisutan ili je rizik velik">🔎 po potrebi</span>';
    if (r.isFirst && !r.done) badges += '<span class="task-badge first">počinje</span>';
    var counts = countTreesByType();
    var chips = r.species.map(function (v) {
        return '<button type="button" class="task-chip" data-species="' + escapeHtml(v) + '" title="Otvori u enciklopediji">' +
            speciesIconHtml(v) + escapeHtml(speciesName(v)) + ' <b>' + counts[v] + '</b></button>';
    }).join('');
    return '<li class="task' + (r.done ? ' done' : '') + '">' +
        '<label class="task-check"><input type="checkbox" data-key="' + escapeHtml(r.key) + '"' +
        (r.done ? ' checked' : '') + (editable ? '' : ' disabled') + ' aria-label="Obavljeno"></label>' +
        '<div class="task-main">' +
        '<div class="task-title">' + (CATEGORY_ICONS[t.kategorija] || '📝') + ' ' + escapeHtml(t.naslov) + badges + '</div>' +
        (t.opis ? '<div class="task-desc">' + escapeHtml(t.opis) + '</div>' : '') +
        (chips ? '<div class="task-chips">' + chips + '</div>' : '') +
        taskActionsHtml(r, editable) +
        '</div></li>';
}

function awayRowHtml(r, editable) {
    var s = r.state;
    var what = s.status === 'skipped'
        ? '🚫 Preskočeno ove sezone'
        : (s.status === 'done' ? '✅ Obavljeno u ' : '⏭️ Odgođeno na ') + escapeHtml(monthLabel(s.to));
    return '<li class="task away">' +
        '<div class="task-main">' +
        '<div class="task-title">' + (CATEGORY_ICONS[r.task.kategorija] || '📝') + ' ' + escapeHtml(r.task.naslov) + '</div>' +
        '<div class="task-desc">' + what + '</div>' +
        (editable && s.status !== 'done'
            ? '<div class="task-actions"><button type="button" class="task-act" data-act="undo" data-key="' + escapeHtml(r.key) + '">↩ Poništi</button></div>'
            : '') +
        '</div></li>';
}

function renderTasks() {
    if (!tasksData || !tasksView) return;
    var now = new Date();
    var isCurrent = tasksView.year === now.getFullYear() && tasksView.month === now.getMonth() + 1;
    document.getElementById('tasks-month').textContent = MONTH_NAMES[tasksView.month - 1] + ' ' + tasksView.year;
    document.getElementById('tasks-season').textContent = seasonName(tasksView.month) + (isCurrent ? ' · ovaj mjesec' : '');
    document.getElementById('tasks-today').classList.toggle('hidden', isCurrent);

    var view = tasksForView();
    var rows = view.active;
    var doneCount = rows.filter(function (r) { return r.done; }).length;
    var progressEl = document.getElementById('tasks-progress');
    progressEl.innerHTML = rows.length
        ? '<div class="tasks-bar"><span style="width:' + Math.round(doneCount / rows.length * 100) + '%"></span></div>' +
          '<span>' + doneCount + ' / ' + rows.length + ' obavljeno</span>'
        : '';

    var listEl = document.getElementById('tasks-list');
    var editable = isAdminUser || storageMode === 'local';
    var prios = tasksData.meta.prioriteti;
    var html = '';

    if (!rows.length && !view.away.length) {
        listEl.innerHTML = '<p class="tasks-empty">Za ovaj mjesec nema posebnih radova za vrste koje imaš na karti. 🌿</p>';
        return;
    }
    if (!rows.length) {
        html += '<p class="tasks-empty">Za ovaj mjesec nema otvorenih radova. 🌿</p>';
    }

    [1, 2, 3].forEach(function (p) {
        var group = rows.filter(function (r) { return r.task.prioritet === p; });
        if (!group.length) return;
        group.sort(function (a, b) {
            if (a.done !== b.done) return a.done ? 1 : -1;
            if (a.isLast !== b.isLast) return a.isLast ? -1 : 1;
            return b.trees - a.trees;
        });
        var info = prios[String(p)];
        html += '<section class="tasks-group prio-' + p + '"><h3>' + info.oznaka + ' ' + escapeHtml(info.naziv) +
            ' <small>' + escapeHtml(info.opis) + '</small></h3><ul>';
        group.forEach(function (r) { html += taskRowHtml(r, editable); });
        html += '</ul></section>';
    });

    if (view.away.length) {
        html += '<section class="tasks-group away-group"><h3>⏭️ Odgođeno / preskočeno</h3><ul>';
        view.away.forEach(function (r) { html += awayRowHtml(r, editable); });
        html += '</ul></section>';
    }

    if (tasksData.meta.napomena) {
        html += '<p class="enc-note">ℹ️ ' + escapeHtml(tasksData.meta.napomena) +
            (editable ? '' : ' Kvačice i odgode može mijenjati samo admin.') + '</p>';
    }
    listEl.innerHTML = html;
}

function setTaskState(key, value) {
    if (value) taskDone[key] = value;
    else delete taskDone[key];
    if (storageMode === 'server') queueServerSync('task', taskDone);
    renderTasks();
}

function shiftTasksMonth(delta) {
    var m = tasksView.month + delta;
    var y = tasksView.year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    tasksView = { year: y, month: m };
    postponingKey = null;
    renderTasks();
}

function openTasks() {
    if (!tasksModal) return;
    var now = new Date();
    tasksView = { year: now.getFullYear(), month: now.getMonth() + 1 };
    postponingKey = null;
    tasksModal.classList.remove('hidden');
    document.getElementById('tasks-list').innerHTML = '<p class="tasks-empty">Učitavanje...</p>';
    loadTasks()
        .then(renderTasks)
        .catch(function (error) {
            console.error(error);
            document.getElementById('tasks-list').innerHTML = '<p class="tasks-empty">Ne mogu učitati raspored.</p>';
        });
}

function closeTasks() {
    if (tasksModal) tasksModal.classList.add('hidden');
}

if (tasksModal) {
    var tasksListEl = document.getElementById('tasks-list');
    var canEditTasks = function () { return isAdminUser || storageMode === 'local'; };

    document.getElementById('open-tasks').addEventListener('click', function () {
        setMenuOpen(false);
        openTasks();
    });
    document.getElementById('close-tasks').addEventListener('click', closeTasks);
    document.getElementById('tasks-prev').addEventListener('click', function () { shiftTasksMonth(-1); });
    document.getElementById('tasks-next').addEventListener('click', function () { shiftTasksMonth(1); });
    document.getElementById('tasks-today').addEventListener('click', function () {
        var now = new Date();
        tasksView = { year: now.getFullYear(), month: now.getMonth() + 1 };
        postponingKey = null;
        renderTasks();
    });
    tasksModal.addEventListener('click', function (event) {
        if (event.target === tasksModal) closeTasks();
    });

    tasksListEl.addEventListener('change', function (event) {
        var box = event.target;
        if (!box || box.type !== 'checkbox') return;
        if (!canEditTasks()) {
            box.checked = !box.checked;
            return;
        }
        var key = box.getAttribute('data-key');
        var prev = getTaskState(key);
        var at = new Date().toISOString();
        if (box.checked) {
            // Zadrži podatak o odgodi, da obavljeni zadatak ostane vidljiv u mjesecu na koji je odgođen.
            setTaskState(key, prev && prev.to
                ? { status: 'done', to: prev.to, from: prev.from, at: at }
                : { status: 'done', at: at });
        } else {
            setTaskState(key, prev && prev.to
                ? { status: 'postponed', to: prev.to, from: prev.from, at: at }
                : null);
        }
    });

    tasksListEl.addEventListener('click', function (event) {
        var chip = event.target.closest('.task-chip');
        if (chip) {
            openEncyclopedia(chip.getAttribute('data-species'));
            return;
        }
        var btn = event.target.closest('.task-act');
        if (!btn || !canEditTasks()) return;
        var act = btn.getAttribute('data-act');
        var key = btn.getAttribute('data-key');
        var at = new Date().toISOString();

        if (act === 'postpone') {
            postponingKey = key;
            renderTasks();
        } else if (act === 'postpone-cancel') {
            postponingKey = null;
            renderTasks();
        } else if (act === 'postpone-ok') {
            var select = tasksListEl.querySelector('.postpone-month[data-key="' + key + '"]');
            if (!select) return;
            var parts = select.value.split('-');
            var prev = getTaskState(key);
            var from = prev && prev.from ? prev.from : { year: tasksView.year, month: tasksView.month };
            postponingKey = null;
            setTaskState(key, { status: 'postponed', to: { year: Number(parts[0]), month: Number(parts[1]) }, from: from, at: at });
        } else if (act === 'skip') {
            postponingKey = null;
            setTaskState(key, { status: 'skipped', at: at });
        } else if (act === 'undo') {
            setTaskState(key, null);
        }
    });
}

// ---------------------------------------------------------------------------
// PWA: service worker, instalacija aplikacije, offline prikaz
// ---------------------------------------------------------------------------
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js')
            .then(function () { return navigator.serviceWorker.ready; })
            .then(function () {
                // Unaprijed dohvati enciklopediju i raspored, da rade i bez interneta.
                if (navigator.onLine === false) return;
                setTimeout(function () {
                    loadEncyclopedia().catch(function () {});
                    loadTasks().catch(function () {});
                    loadVegetables().catch(function () {});
                }, 2000);
            })
            .catch(function (error) {
                console.error('Service worker nije registriran:', error);
            });
    });
}

function showOfflineBanner() {
    var banner = document.getElementById('offline-banner');
    if (banner) banner.classList.remove('hidden');
}

window.addEventListener('online', function () {
    if (!isOfflineData) return;
    var text = document.getElementById('offline-text');
    var reload = document.getElementById('offline-reload');
    if (text) text.textContent = '📶 Opet si online.';
    if (reload) reload.classList.remove('hidden');
});

var offlineReloadBtn = document.getElementById('offline-reload');
if (offlineReloadBtn) {
    offlineReloadBtn.addEventListener('click', function () { window.location.reload(); });
}

var deferredInstallPrompt = null;
var installAppBtn = document.getElementById('install-app');
var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
var isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Android / Chrome / Edge: preglednik javi da se aplikacija može instalirati
window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installAppBtn) installAppBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    if (installAppBtn) installAppBtn.classList.add('hidden');
});

// iPhone / iPad nema automatski prozor za instalaciju: prikaži upute
if (installAppBtn && isIos && !isStandalone) {
    installAppBtn.classList.remove('hidden');
}

if (installAppBtn) {
    installAppBtn.addEventListener('click', function () {
        setMenuOpen(false);
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then(function () {
                deferredInstallPrompt = null;
                installAppBtn.classList.add('hidden');
            });
            return;
        }
        if (isIos) {
            alert('Instalacija na iPhone/iPad:\n\n1. Otvori stranicu u Safariju\n2. Dodirni gumb Dijeli (kvadrat sa strelicom)\n3. Odaberi "Dodaj na početni zaslon"');
        }
    });
}

// ---------------------------------------------------------------------------
// Označavanje odabranog stabla na karti (plavi obrub)
// ---------------------------------------------------------------------------
var highlightedMarkerId = null;

function highlightSelectedMarker() {
    var wantedId = selectedPlant ? selectedPlant.itemId : null;

    if (highlightedMarkerId && highlightedMarkerId !== wantedId) {
        var old = allMarkersById[highlightedMarkerId];
        if (old) {
            var oldEl = old.getElement();
            if (oldEl) oldEl.classList.remove('marker-selected');
            old.setZIndexOffset(0);
        }
        highlightedMarkerId = null;
    }

    if (!wantedId) return;
    var marker = allMarkersById[wantedId];
    if (!marker) return;
    var el = marker.getElement();
    if (el) el.classList.add('marker-selected');
    marker.setZIndexOffset(1000); // ispred susjednih ikona
    highlightedMarkerId = wantedId;
}

// ---------------------------------------------------------------------------
// Enciklopedija: kartica "Povrće" (podaci u data/povrce.json)
// Kalendar: plavo = sjetva u zatvorenom, zeleno = sadnja/sjetva vani, žuto = berba
// ---------------------------------------------------------------------------
var encyclopediaMode = 'voce'; // 'voce' | 'povrce'
var vegData = null;
var vegLoading = null;
var vegSelectedId = 'kalendar';
var MONTH_ABBR = ['Sij', 'Vel', 'Ožu', 'Tra', 'Svi', 'Lip', 'Srp', 'Kol', 'Ruj', 'Lis', 'Stu', 'Pro'];
var VEG_COLORS = { unutra: 'var(--veg-unutra)', sadnja: 'var(--veg-sadnja)', berba: 'var(--veg-berba)' };

function loadVegetables() {
    if (vegData) return Promise.resolve(vegData);
    if (!vegLoading) {
        vegLoading = fetchJsonFile('data/povrce.json?v=20261121f')
            .then(function (data) {
                vegData = data;
                return data;
            })
            .catch(function (error) {
                vegLoading = null;
                throw error;
            });
    }
    return vegLoading;
}

function vegCellHtml(entry, month) {
    var kinds = ['unutra', 'sadnja', 'berba'].filter(function (k) {
        return (entry[k] || []).indexOf(month) !== -1;
    });
    var style = '';
    if (kinds.length === 1) {
        style = 'background:' + VEG_COLORS[kinds[0]];
    } else if (kinds.length > 1) {
        // Više stvari u istom mjesecu: dijagonalno podijeljena ćelija
        var step = 100 / kinds.length;
        style = 'background:linear-gradient(135deg,' + kinds.map(function (k, i) {
            return VEG_COLORS[k] + ' ' + (i * step) + '%,' + VEG_COLORS[k] + ' ' + ((i + 1) * step) + '%';
        }).join(',') + ')';
    }
    var legend = vegData.meta.legenda;
    var title = MONTH_NAMES[month - 1] + (kinds.length ? ': ' + kinds.map(function (k) { return legend[k]; }).join(', ') : '');
    var isNow = month === new Date().getMonth() + 1;
    return '<td class="veg-cell' + (isNow ? ' now' : '') + '" style="' + style + '" title="' + escapeHtml(title) + '">' +
        '<span class="sr-only">' + escapeHtml(kinds.map(function (k) { return legend[k]; }).join(', ')) + '</span></td>';
}

function vegMonthHeaderHtml(firstCol) {
    var nowMonth = new Date().getMonth() + 1;
    return '<thead><tr>' + (firstCol ? '<th scope="col" class="veg-name-col">' + firstCol + '</th>' : '') +
        MONTH_ABBR.map(function (m, i) {
            return '<th scope="col"' + (i + 1 === nowMonth ? ' class="now"' : '') + '>' + m + '</th>';
        }).join('') + '</tr></thead>';
}

function vegLegendHtml() {
    var l = vegData.meta.legenda;
    return '<div class="veg-legend">' +
        '<span><i style="background:' + VEG_COLORS.unutra + '"></i>' + escapeHtml(l.unutra) + '</span>' +
        '<span><i style="background:' + VEG_COLORS.sadnja + '"></i>' + escapeHtml(l.sadnja) + '</span>' +
        '<span><i style="background:' + VEG_COLORS.berba + '"></i>' + escapeHtml(l.berba) + '</span>' +
        '<span><i class="now-swatch"></i>Ovaj mjesec</span>' +
        '</div>';
}

function renderVegList() {
    if (!vegData || !encyclopediaListEl) return;
    var items = [{ id: 'kalendar', naziv: 'Kalendar (sve)', emoji: '📅' }].concat(vegData.vrste);
    encyclopediaListEl.innerHTML = items.map(function (entry) {
        var active = entry.id === vegSelectedId;
        return '<button type="button" class="enc-item' + (active ? ' active' : '') + '" data-id="' + escapeHtml(entry.id) + '"' +
            (active ? ' aria-current="true"' : '') + '>' +
            '<span class="enc-emoji" style="font-size:18px">' + escapeHtml(entry.emoji) + '</span>' +
            '<span class="enc-item-name">' + escapeHtml(entry.naziv) + '</span></button>';
    }).join('');
}

function renderVegArticle() {
    if (!vegData || !encyclopediaArticleEl) return;
    var html = '';

    if (vegSelectedId === 'kalendar') {
        html += '<header class="enc-head"><span class="enc-emoji" style="font-size:36px">📅</span>' +
            '<div><h2>Kalendar sjetve i berbe</h2><div class="enc-onmap">Klikni povrće za detalje</div></div></header>';
        html += vegLegendHtml();
        html += '<div class="veg-table-wrap"><table class="veg-table veg-table-all">' + vegMonthHeaderHtml('Povrće') + '<tbody>' +
            vegData.vrste.map(function (v) {
                return '<tr><th scope="row" class="veg-name-col"><button type="button" class="veg-link" data-id="' + escapeHtml(v.id) + '">' +
                    escapeHtml(v.emoji) + ' ' + escapeHtml(v.naziv) + '</button></th>' +
                    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return vegCellHtml(v, m); }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
    } else {
        var v = vegData.vrste.find(function (x) { return x.id === vegSelectedId; });
        if (!v) {
            encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Odaberi povrće s popisa.</p>';
            return;
        }
        html += '<header class="enc-head"><span class="enc-emoji" style="font-size:40px">' + escapeHtml(v.emoji) + '</span>' +
            '<div><h2>' + escapeHtml(v.naziv) + '</h2>' +
            (v.latinski ? '<i class="enc-latin">' + escapeHtml(v.latinski) + '</i>' : '') + '</div></header>';
        html += '<div class="veg-table-wrap"><table class="veg-table veg-table-one">' + vegMonthHeaderHtml('') + '<tbody><tr>' +
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return vegCellHtml(v, m); }).join('') +
            '</tr></tbody></table></div>';
        html += vegLegendHtml();
        html += '<p>' + escapeHtml(v.opis) + '</p>';
        html += '<section><h3>🌱 Sjetva / sadnja</h3><p>' + escapeHtml(v.sjetva) + '</p></section>';
        html += '<section><h3>☀️ Položaj</h3><p>' + escapeHtml(v.polozaj) + '</p></section>';
        html += '<section><h3>💧 Voda</h3><p>' + escapeHtml(v.voda) + '</p></section>';
        html += '<section><h3>🧑‍🌾 Njega</h3><p>' + escapeHtml(v.njega) + '</p></section>';
        html += '<section><h3>🐛 Česti problemi</h3><p>' + escapeHtml(v.problemi) + '</p></section>';
        if (v.dobriSusjedi || v.losiSusjedi) {
            html += '<section><h3>🤝 Susjedi u vrtu</h3>' +
                (v.dobriSusjedi ? '<p><b>Dobro uz:</b> ' + escapeHtml(v.dobriSusjedi) + '</p>' : '') +
                (v.losiSusjedi ? '<p><b>Ne saditi uz:</b> ' + escapeHtml(v.losiSusjedi) + '</p>' : '') + '</section>';
        }
        html += '<section><h3>🧺 Berba</h3><p>' + escapeHtml(v.berbaOpis) + '</p></section>';
    }

    if (vegData.meta.napomena) html += '<p class="enc-note">ℹ️ ' + escapeHtml(vegData.meta.napomena) + '</p>';
    encyclopediaArticleEl.innerHTML = html;
    encyclopediaArticleEl.scrollTop = 0;
}

function setEncyclopediaMode(mode) {
    encyclopediaMode = mode === 'povrce' ? 'povrce' : 'voce';
    document.querySelectorAll('.enc-tab').forEach(function (tab) {
        var on = tab.getAttribute('data-mode') === encyclopediaMode;
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var card = document.querySelector('.encyclopedia-card');
    if (card) card.classList.toggle('mode-povrce', encyclopediaMode === 'povrce');
    var loader = encyclopediaMode === 'povrce' ? loadVegetables() : loadEncyclopedia();
    if (encyclopediaArticleEl && !(encyclopediaMode === 'povrce' ? vegData : encyclopediaData)) {
        encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Učitavanje...</p>';
    }
    return loader.then(function (data) {
        if (encyclopediaMode === 'voce' && !encyclopediaSelectedId) encyclopediaSelectedId = data.vrste[0].id;
        renderEncyclopediaList();
        renderEncyclopediaArticle();
    }).catch(function (error) {
        console.error(error);
        if (encyclopediaArticleEl) encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Ne mogu učitati podatke.</p>';
    });
}

document.querySelectorAll('.enc-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setEncyclopediaMode(tab.getAttribute('data-mode')); });
});

if (encyclopediaArticleEl) {
    encyclopediaArticleEl.addEventListener('click', function (event) {
        var link = event.target.closest('.veg-link');
        if (link) selectEncyclopediaEntry(link.getAttribute('data-id'));
    });
}
