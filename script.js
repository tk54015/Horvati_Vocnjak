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
var syncSnapshot = { user: {}, note: {}, details: {}, position: {}, deleted: {}, task: {}, log: {}, harvest: {}, ttask: {}, ctask: {}, bed: {} };
var customTasks = {}; // vlastiti zadaci: id -> { id, naslov, opis, mjeseci, godina?, prioritet, kategorija, vrste }
var tasksBaseZadaci = null;
var treeTaskStates = {}; // stanje zadatka po stablu: id -> { ključZadatka: { status: 'postponed'|'skipped', to?, from? } }
var plantLogs = {}; // dnevnik po stablu: id -> [{ id, date, type, text, taskKey? }]
var plantHarvests = {}; // berba po stablu: id -> { godina: { kg, note } }
var taskDone = {}; // obavljeni zadaci iz rasporeda: 'godina:zadatak' -> { done, at }
var deletedIds = {}; // izbrisana originalna stabla: id -> { deletedAt, name, treeType }
var pendingChanges = {};
var syncInFlight = false;
var syncRetryTimer = null;
var syncFlushTimer = null;
var isAdminUser = false;
// Probni admin način: sve admin opcije, ali spremanje samo u localStorage ovog preglednika
var DEMO_FLAG_KEY = 'horvati_demo_mode';
var DEMO_STATE_KEY = 'horvati_demo_state_v1';
var DEMO_WALLET_KEY = 'horvati_demo_wallet_v1';
var demoMode = (function () {
    try { return localStorage.getItem(DEMO_FLAG_KEY) === '1'; } catch (e) { return false; }
})();
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
    } else if (state === 'ok' && demoMode) {
        el.textContent = '🧪 Spremljeno samo u ovom pregledniku.';
    } else if (state === 'ok') {
        el.textContent = '☁️ Sve spremljeno na server.';
    } else {
        el.textContent = 'Sve novo ostaje spremljeno nakon refresha.';
    }
}

function queueServerSync(kind, currentMap) {
    if (demoMode) { scheduleDemoSave(); return; }
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
    plantLogs = asPlainObject(state.plantLogs);
    plantHarvests = asPlainObject(state.plantHarvests);
    treeTaskStates = asPlainObject(state.treeTaskStates);
    customTasks = asPlainObject(state.customTasks);
    beds = asPlainObject(state.beds);
    serverUserItemsRaw = Array.isArray(state.userItems) ? state.userItems : [];

    syncSnapshot = {
        user: buildSnapshotFromMap(userItemsAsMap(serverUserItemsRaw)),
        note: buildSnapshotFromMap(noteOverrides),
        details: buildSnapshotFromMap(plantDetails),
        position: buildSnapshotFromMap(positionOverrides),
        deleted: buildSnapshotFromMap(deletedIds),
        task: buildSnapshotFromMap(taskDone),
        log: buildSnapshotFromMap(plantLogs),
        harvest: buildSnapshotFromMap(plantHarvests),
        ttask: buildSnapshotFromMap(treeTaskStates),
        ctask: buildSnapshotFromMap(customTasks),
        bed: buildSnapshotFromMap(beds)
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
        drenak: '🔴',
        kupina: '🫐',
        ribizl: '🍓',
        dud2: '🍇',
        vinova_loza: '🍇',
        kivi: '🥝',
        borovnica: '🫐',
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
        drenak: '🔴',
        kupina: '🫐',
        ribizl: '🍓',
        dud2: '🍇',
        vinova_loza: '🍇',
        kivi: '🥝',
        borovnica: '🫐',
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
var EMOJI_MARKERS = { ostalo: '🌳', kivi: '🥝', dud2: '🍇' };
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
    borovnica: 3,
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
    borovnica: { adultHeightM: 1.6, minKg: 2, maxKg: 5 },
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
    borovnica: 3,
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
    if (t.indexOf('borovnic') !== -1 || t.indexOf('blueberr') !== -1) return 'borovnica';
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
    if (t === 'orah') return 'icons/orah.png';
    if (t === 'drenak') return 'icons/drenak.png';
    if (t === 'borovnica') return 'icons/borovnica.png';
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
    if (typeof selectedBedId !== 'undefined' && selectedBedId) closeBedPanel();
    if (emptyEl) emptyEl.classList.add('hidden');

    document.getElementById('plant-id').textContent = item.id || '-';
    document.getElementById('plant-height').textContent = formatMeters(item.heightM);
    document.getElementById('plant-coords').textContent = Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2);

    var waterEl = document.getElementById('plant-water');
    if (waterEl) {
        var t = normalizeType(item.treeType);
        var level = WATER_NEED_LEVEL[t] !== undefined ? WATER_NEED_LEVEL[t] : WATER_NEED_LEVEL._default;
        var drops = '';
        for (var i = 0; i < 4; i++) { drops += i < level ? '\uD83D\uDCA7' : '<span class="drop-off">\uD83D\uDCA7</span>'; }
        waterEl.innerHTML = drops;
    }

    var details = getPlantDetails(item.id);
    var logDate = document.getElementById('pp-log-date');
    if (logDate) logDate.value = todayIso();
    setPlantPanelTab('pregled');
    renderPlantExtras(item);

    var noteInput = document.getElementById('status-napomena');
    noteInput.value = details.napomena || item.notes || '';
    noteInput.setAttribute('readonly', 'readonly');
    updatePlantFormEditable();
}

function saveSelectedPlantPanel() {
    if (!selectedPlant || !canEdit()) return;
    var item = allItemsById[selectedPlant.itemId];
    if (!item) return;

    var details = Object.assign({}, getPlantDetails(item.id), {
        napomena: document.getElementById('status-napomena').value.trim()
    });

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
        scheduleMapRefresh();
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
                setAdminMode(demoMode ? true : results[1]);
                if (demoMode) showDemoUi();
            }

            return ensureServerSeeded(state).then(function (seededState) {
                applyServerState(demoMode ? demoOverlay(seededState) : seededState);
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
                loadTasks().then(scheduleMapRefresh).catch(function () {});
                loadVegetables().then(renderBeds).catch(renderBeds);
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
        if (event.key !== 'Enter' || noteInputEl.tagName === 'TEXTAREA') return;
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
        closeFilterPanel();
        closeWallet();
        closeReport();
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
    scheduleMapRefresh();
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
    if (selectedPlant && allItemsById[selectedPlant.itemId] && typeof renderPlantExtras === 'function') {
        renderPlantExtras(allItemsById[selectedPlant.itemId]);
    }
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
        if (demoMode) { exitDemo(); return; }
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
    scheduleMapRefresh();
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
        encyclopediaLoading = fetchJsonFile('data/enciklopedija.json?v=20261123c')
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
    var sprayActive = encyclopediaSelectedId === SPRAY_PAGE_ID;
    encyclopediaListEl.innerHTML = '<button type="button" class="enc-item enc-special' + (sprayActive ? ' active' : '') + '" data-id="' + SPRAY_PAGE_ID + '"' + (sprayActive ? ' aria-current="true"' : '') + '><span class="enc-emoji" style="font-size:18px">🧴</span><span class="enc-item-name">Špricanje i pripravci</span></button>' + sortedFruitEntries().map(function (entry) {
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

function listHtml(items, icon) {
    if (!items || !items.length) return '<p class="enc-muted">Nema posebnih napomena.</p>';
    return '<div class="enc-problems">' + items.map(function (it) {
        var recognize = it.prepoznaj || it.opis || '';
        return '<div class="enc-problem">' +
            '<div class="enc-problem-name">' + (icon || '') + ' ' + escapeHtml(it.naziv) + '</div>' +
            (recognize ? '<div class="enc-problem-row"><span class="enc-tag see">🔍 Kako prepoznati</span><p>' + escapeHtml(recognize) + '</p></div>' : '') +
            (it.rjesenje ? '<div class="enc-problem-row"><span class="enc-tag fix">✅ Što napraviti</span><p>' + escapeHtml(it.rjesenje) + '</p></div>' : '') +
            '</div>';
    }).join('') + '</div>';
}

function renderEncyclopediaArticle() {
    if (encyclopediaMode === 'povrce') { renderVegArticle(); return; }
    if (!encyclopediaData || !encyclopediaArticleEl) return;
    if (encyclopediaSelectedId === SPRAY_PAGE_ID) { renderSprayPage(); return; }
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
        html += '<section><h3>🦠 Bolesti</h3>' + listHtml(entry.bolesti, '🦠') + '</section>';
    }
    if (entry.stetnici && entry.stetnici.length) {
        html += '<section><h3>🐛 Štetnici</h3>' + listHtml(entry.stetnici, '🐛') + '</section>';
    }
    if (entry.zastita && entry.zastita.length) {
        html += '<section><h3>🗓️ Kalendar zaštite (sažetak)</h3><table class="enc-table"><tbody>' +
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
            var exists = wanted === SPRAY_PAGE_ID || data.vrste.some(function (v) { return v.id === wanted; });
            selectEncyclopediaEntry(exists ? wanted : sortedFruitEntries()[0].id);
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
var CATEGORY_ICONS = { orezivanje: '✂️', 'zaštita': '🧴', gnojidba: '🌱', berba: '🧺', voda: '💧', higijena: '🧹', vrijeme: '🌡️', ostalo: '📝', vlastito: '📌' };
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
        tasksLoading = Promise.all([fetchJsonFile('data/raspored.json?v=20261123a'), loadEncyclopedia().catch(function () { return null; })])
            .then(function (results) {
                tasksData = results[0];
                tasksBaseZadaci = tasksData.zadaci.slice();
                mergeCustomTasks();
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
        if (task.godina && task.godina !== year) return; // jednokratni vlastiti zadatak
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
    if (t.custom) badges += '<span class="task-badge custom">📌 vlastiti</span>';
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
        taskProgressHtml(r) +
        taskActionsHtml(r, editable) +
        (t.custom && editable ? '<div class="task-actions"><button type="button" class="task-act" data-act="custom-del" data-key="' + escapeHtml(t.id) + '">🗑️ Obriši vlastiti zadatak</button></div>' : '') +
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

    var view = filterTasksBySpecies(tasksForView());
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
    onTasksChanged();
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

function openTasks(speciesFilter) {
    tasksSpeciesFilter = speciesFilter ? normalizeType(speciesFilter) : '';
    if (!tasksModal) return;
    var now = new Date();
    tasksView = { year: now.getFullYear(), month: now.getMonth() + 1 };
    postponingKey = null;
    tasksModal.classList.remove('hidden');
    document.getElementById('tasks-list').innerHTML = '<p class="tasks-empty">Učitavanje...</p>';
    loadTasks()
        .then(function () { renderTasksSpeciesSelect(); renderTasks(); })
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
        } else if (act === 'custom-del') {
            var ct = customTasks[key];
            askConfirm('Obrisati zadatak?', 'Obrisati vlastiti zadatak "' + (ct ? ct.naslov : key) + '"?', '🗑️ Obriši').then(function (ok) {
                if (ok) removeCustomTask(key);
            });
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
        vegLoading = fetchJsonFile('data/povrce.json?v=20261123a')
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
    var items = [{ id: 'kalendar', naziv: 'Kalendar (sve)', emoji: '📅' }, { id: 'savjeti', naziv: 'Opći savjeti', emoji: '📋' }].concat(sortByName(vegData.vrste));
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
            sortByName(vegData.vrste).map(function (v) {
                return '<tr><th scope="row" class="veg-name-col"><button type="button" class="veg-link" data-id="' + escapeHtml(v.id) + '">' +
                    escapeHtml(v.emoji) + ' ' + escapeHtml(v.naziv) + '</button></th>' +
                    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (m) { return vegCellHtml(v, m); }).join('') + '</tr>';
            }).join('') + '</tbody></table></div>';
    } else if (vegSelectedId === 'savjeti') {
        html += '<header class="enc-head"><span class="enc-emoji" style="font-size:36px">📋</span>' +
            '<div><h2>Opći savjeti za povrtnjak</h2><div class="enc-onmap">Tlo, plodored, presadnice, voda, malč, skladištenje</div></div></header>';
        (vegData.meta.savjeti || []).forEach(function (s) {
            html += '<section><h3>' + escapeHtml(s.naslov) + '</h3><p>' + escapeHtml(s.tekst) + '</p></section>';
        });
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
        html += '<section><h3>🌿 Njega</h3><p>' + escapeHtml(v.njega) + '</p></section>';
        html += '<section><h3>🐛 Česti problemi</h3><p>' + escapeHtml(v.problemi) + '</p></section>';
        if (v.kombinacije || v.pazi) {
            html += '<section><h3>🤝 Gredica i plodored</h3>' +
                (v.kombinacije ? '<p><b>Pogodne kombinacije:</b> ' + escapeHtml(v.kombinacije) + '</p>' : '') +
                (v.pazi ? '<p><b>Na što paziti:</b> ' + escapeHtml(v.pazi) + '</p>' : '') + '</section>';
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
        if (encyclopediaMode === 'voce' && !encyclopediaSelectedId) encyclopediaSelectedId = sortedFruitEntries()[0].id;
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

// ---------------------------------------------------------------------------
// Podaci o biljci: Pregled (zadaci, zadnji radovi, napomena), Dnevnik, Berba
// + oznake zadataka (❗) na karti + filter i pretraga
// ---------------------------------------------------------------------------
var LOG_TYPES = {
    orezivanje: { icon: '✂️', naziv: 'Orezivanje' },
    prskanje: { icon: '🧴', naziv: 'Prskanje' },
    gnojidba: { icon: '🌱', naziv: 'Kompost / gnojidba' },
    zalijevanje: { icon: '💧', naziv: 'Zalijevanje' },
    pregled: { icon: '🔍', naziv: 'Pregled' },
    bolest: { icon: '🦠', naziv: 'Bolest / štetnik' },
    ostalo: { icon: '📝', naziv: 'Ostalo' }
};
// Kategorija zadatka iz rasporeda -> vrsta zapisa u dnevniku
var TASK_CATEGORY_TO_LOG = { orezivanje: 'orezivanje', 'zaštita': 'prskanje', gnojidba: 'gnojidba', voda: 'zalijevanje' };
var STAGE_LABELS = { mlado: '🌱 Mlado', u_razvoju: '🌿 U razvoju', odraslo: '🌳 Odraslo' };
var CANOPY_LABELS = { mala: 'Krošnja: mala', srednja: 'Krošnja: srednja', velika: 'Krošnja: velika' };
var plantPanelTab = 'pregled';

function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatHrDate(iso) {
    var p = String(iso || '').split('-');
    if (p.length !== 3) return iso || '';
    return Number(p[2]) + '.' + Number(p[1]) + '.' + p[0] + '.';
}

function daysAgoText(iso) {
    var d = new Date(iso + 'T12:00:00');
    var diff = Math.round((Date.now() - d.getTime()) / 86400000);
    if (isNaN(diff)) return '';
    if (diff <= 0) return 'danas';
    if (diff === 1) return 'jučer';
    if (diff < 60) return 'prije ' + diff + ' dana';
    var months = Math.round(diff / 30);
    if (months < 24) return 'prije ' + months + ' mj.';
    return 'prije ' + Math.round(diff / 365) + ' god.';
}

function getPlantLogs(itemId) {
    var list = plantLogs[itemId];
    return Array.isArray(list) ? list.slice().sort(function (a, b) {
        return String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id));
    }) : [];
}

function savePlantLogs() {
    if (storageMode === 'server') queueServerSync('log', plantLogs);
}

function savePlantHarvests() {
    if (storageMode === 'server') queueServerSync('harvest', plantHarvests);
}

function addPlantLog(itemId, entry) {
    if (!canEdit()) return;
    var list = Array.isArray(plantLogs[itemId]) ? plantLogs[itemId].slice() : [];
    entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    entry.at = new Date().toISOString();
    list.push(entry);
    plantLogs[itemId] = list;
    savePlantLogs();
    afterPlantDataChange();
}

function removePlantLog(itemId, logId) {
    if (!canEdit()) return;
    var list = (plantLogs[itemId] || []).filter(function (e) { return e.id !== logId; });
    if (list.length) plantLogs[itemId] = list;
    else delete plantLogs[itemId];
    savePlantLogs();
    afterPlantDataChange();
}

function afterPlantDataChange() {
    reconcileSpeciesTasks();
    if (selectedPlant && allItemsById[selectedPlant.itemId]) renderPlantExtras(allItemsById[selectedPlant.itemId]);
    scheduleMapRefresh();
}

// ----- zadaci za stablo -------------------------------------------------------

function currentMonthTaskRows() {
    if (!tasksData) return null;
    var saved = tasksView;
    var now = new Date();
    tasksView = { year: now.getFullYear(), month: now.getMonth() + 1 };
    var rows = tasksForView().active;
    tasksView = saved;
    return rows;
}

// Početak trenutnog "prozora" zadatka (npr. za zadatak veljača–ožujak u ožujku: 1. veljače)
function taskWindowStartIso(task) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var steps = 0;
    while (steps < 11) {
        var prev = m - 1 < 1 ? 12 : m - 1;
        if ((task.mjeseci || []).indexOf(prev) === -1) break;
        m = prev;
        if (m === 12) y -= 1;
        steps++;
    }
    return y + '-' + String(m).padStart(2, '0') + '-01';
}

function treeTaskHandledEntry(itemId, row) {
    var logType = TASK_CATEGORY_TO_LOG[row.task.kategorija];
    var since = taskWindowStartIso(row.task);
    var logs = getPlantLogs(itemId);
    for (var i = 0; i < logs.length; i++) {
        var e = logs[i];
        if (e.taskKey === row.key) return e;
        if (logType && e.type === logType && String(e.date) >= since) return e;
    }
    return null;
}

function treeTasks(item) {
    var rows = currentMonthTaskRows();
    if (!rows) return null;
    var type = normalizeType(item.treeType);
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth() + 1;
    var list = rows
        .filter(function (r) { return (r.task.vrste || []).indexOf(type) !== -1; })
        .map(function (r) { return { row: r }; });

    // zadaci koje je samo ovo stablo odgodilo na ovaj mjesec
    var states = treeTaskStates[item.id] || {};
    Object.keys(states).forEach(function (key) {
        var st = states[key];
        if (!st || st.status !== 'postponed' || !sameMonth(st.to, y, m)) return;
        if (list.some(function (x) { return x.row.key === key; })) return;
        var task = tasksData.zadaci.find(function (t) { return t.id === taskIdFromKey(key); });
        if (!task) return;
        var sp = getTaskState(key);
        list.push({ row: { task: task, key: key, done: !!sp && sp.status === 'done', isLast: false, isFirst: false, movedHere: true }, movedIn: true });
    });

    list.forEach(function (t) {
        t.handled = treeTaskHandledEntry(item.id, t.row);
        var st = getTreeTaskState(item.id, t.row.key);
        t.treeState = st;
        t.skipped = !!st && st.status === 'skipped';
        t.postponedAway = !!st && st.status === 'postponed' && !sameMonth(st.to, y, m);
        t.resolved = !!t.handled || t.skipped || t.row.done;
        t.open = !t.resolved && !t.postponedAway;
    });
    return list.sort(function (a, b) {
        return (a.open ? 0 : 1) - (b.open ? 0 : 1) || a.row.task.prioritet - b.row.task.prioritet;
    });
}

// 1 = važno, 2 = redovno, 0 = ništa otvoreno
function treeAlertLevel(item) {
    var list = treeTasks(item);
    if (!list) return 0;
    var level = 0;
    list.forEach(function (t) {
        if (!t.open) return;
        var p = t.row.task.prioritet;
        if (p <= 2 && (level === 0 || p < level)) level = p;
    });
    return level;
}

function getTreeTaskState(itemId, key) {
    var map = treeTaskStates[itemId];
    return map && map[key] ? map[key] : null;
}

function setTreeTaskState(itemId, key, value) {
    if (!canEdit()) return;
    var map = Object.assign({}, treeTaskStates[itemId] || {});
    if (value) map[key] = value;
    else delete map[key];
    if (Object.keys(map).length) treeTaskStates[itemId] = map;
    else delete treeTaskStates[itemId];
    if (storageMode === 'server') queueServerSync('ttask', treeTaskStates);
    afterPlantDataChange();
}

// Zadatak vrste se sam označi obavljenim kad su sva stabla te vrste napravljena ili preskočena
// (i opet otvori ako se to poništi, ali samo ako ga je aplikacija sama zatvorila).
var reconcilingTasks = false;
function reconcileSpeciesTasks() {
    if (reconcilingTasks || !tasksData || !canEdit()) return;
    reconcilingTasks = true;
    try {
        (currentMonthTaskRows() || []).forEach(function (r) {
            var progress = speciesTreeProgress(r);
            if (!progress || !progress.total) return;
            var allResolved = progress.handled + progress.skipped === progress.total;
            var st = getTaskState(r.key);
            var at = new Date().toISOString();
            if (allResolved && !(st && st.status === 'done')) {
                var doneState = { status: 'done', auto: true, at: at };
                if (st && st.to) { doneState.to = st.to; doneState.from = st.from; }
                setTaskState(r.key, doneState);
            } else if (!allResolved && st && st.status === 'done' && st.auto) {
                setTaskState(r.key, st.to ? { status: 'postponed', to: st.to, from: st.from, at: at } : null);
            }
        });
    } finally {
        reconcilingTasks = false;
    }
}

// Koliko je stabla vrste/vrsta zadatka napravljeno / preskočeno / odgođeno (za tekući mjesec)
function speciesTreeProgress(row) {
    var species = row.species || (row.task.vrste || []);
    if (!species.length) return null;
    var now = new Date();
    var res = { total: 0, handled: 0, skipped: 0, postponed: 0 };
    allMapItems().forEach(function (item) {
        if (species.indexOf(normalizeType(item.treeType)) === -1) return;
        res.total++;
        var st = getTreeTaskState(item.id, row.key);
        if (treeTaskHandledEntry(item.id, row)) res.handled++;
        else if (st && st.status === 'skipped') res.skipped++;
        else if (st && st.status === 'postponed' && !sameMonth(st.to, now.getFullYear(), now.getMonth() + 1)) res.postponed++;
    });
    return res;
}

// ----- prikaz panela ----------------------------------------------------------

function renderPlantHeader(item) {
    var type = normalizeType(item.treeType);
    var icon = iconByType(item.treeType);
    var iconEl = document.getElementById('pp-icon');
    if (iconEl) {
        var emoji = EMOJI_MARKERS[type] || (getTypeWithEmoji(item.treeType).split(' ')[1] || '🌳');
        iconEl.innerHTML = icon ? '<img src="' + icon + '" alt="">' : '<span>' + escapeHtml(emoji) + '</span>';
    }
    var nameEl = document.getElementById('pp-name');
    if (nameEl) nameEl.textContent = item.name || item.id;
    document.getElementById('plant-type').textContent = speciesName(type) || item.treeType || '-';

    var stageEl = document.getElementById('pp-stage');
    var canopyEl = document.getElementById('pp-canopy');
    if (stageEl) {
        var stage = STAGE_LABELS[String(item.growthStage || '').toLowerCase()];
        stageEl.textContent = stage || '';
        stageEl.classList.toggle('hidden', !stage);
    }
    if (canopyEl) {
        var canopy = CANOPY_LABELS[String(item.canopyDensity || '').toLowerCase()];
        canopyEl.textContent = canopy || '';
        canopyEl.classList.toggle('hidden', !canopy);
    }
}

var treePostponingKey = null;

function nextMonthsOptions(count) {
    var now = new Date();
    var html = '';
    for (var i = 1; i <= count; i++) {
        var m = now.getMonth() + 1 + i;
        var y = now.getFullYear();
        while (m > 12) { m -= 12; y += 1; }
        html += '<option value="' + y + '-' + m + '">' + MONTH_NAMES[m - 1] + ' ' + y + '</option>';
    }
    return html;
}

function renderPlantTasks(item) {
    var el = document.getElementById('pp-tasks');
    if (!el) return;
    var list = treeTasks(item);
    var monthName = MONTH_NAMES[new Date().getMonth()];
    if (!list) {
        el.innerHTML = '<p class="pp-muted">Učitavanje zadataka…</p>';
        loadTasks().then(function () { if (selectedPlant && selectedPlant.itemId === item.id) renderPlantTasks(item); }).catch(function () {});
        return;
    }
    var editable = canEdit();
    var html = '<h4 class="pp-h">📋 Zadaci – ' + escapeHtml(monthName.toLowerCase()) + '</h4>';
    if (!list.length) {
        el.innerHTML = html + '<p class="pp-muted">Ovaj mjesec nema zadataka za ovu vrstu. 🌿</p>';
        return;
    }
    html += '<ul class="pp-tasklist">';
    list.forEach(function (t) {
        var task = t.row.task;
        var key = escapeHtml(t.row.key);
        var undo = function (act, extra) {
            return editable ? ' <button type="button" class="pp-undo" data-act="' + act + '" data-key="' + key + '"' + (extra || '') + ' title="Poništi">↩</button>' : '';
        };
        var status = '';
        if (t.handled) {
            status = '<span class="pp-ok">✓ Napravljeno ' + escapeHtml(formatHrDate(t.handled.date)) + '</span>' +
                (t.handled.taskKey === t.row.key ? undo('tree-undo-log', ' data-log="' + escapeHtml(t.handled.id) + '"') : '');
        } else if (t.skipped) {
            status = '<span class="pp-skip">⊘ Preskočeno ove sezone</span>' + undo('tree-undo-state');
        } else if (t.postponedAway) {
            status = '<span class="pp-post">⇄ Odgođeno na ' + escapeHtml(monthLabel(t.treeState.to)) + '</span>' + undo('tree-undo-state');
        } else if (t.row.done) {
            status = '<span class="pp-ok">✓ Obavljeno za cijelu vrstu</span>';
        } else if (editable && treePostponingKey === t.row.key) {
            status = '<span class="pp-postpone-picker"><select class="pp-postpone-month">' + nextMonthsOptions(6) + '</select>' +
                '<button type="button" class="pp-act" data-act="tree-postpone-ok" data-key="' + key + '">Odgodi</button>' +
                '<button type="button" class="pp-undo" data-act="tree-postpone-cancel" title="Odustani">✕</button></span>';
        } else if (editable) {
            status = '<span class="pp-tri">' +
                '<button type="button" class="pp-tri-btn ok" data-act="task-done" data-key="' + key + '" title="Napravljeno na ovom stablu" aria-label="Napravljeno na ovom stablu">✓</button>' +
                '<button type="button" class="pp-tri-btn post" data-act="tree-postpone" data-key="' + key + '" title="Odgodi za ovo stablo" aria-label="Odgodi za ovo stablo">⇄</button>' +
                '<button type="button" class="pp-tri-btn skip" data-act="tree-skip" data-key="' + key + '" title="Preskoči ove sezone za ovo stablo" aria-label="Preskoči ove sezone za ovo stablo">⊘</button>' +
                '</span>';
        }
        var badge = task.poPotrebi ? ' <span class="task-badge cond">🔎 po potrebi</span>' : '';
        if (t.movedIn) badge += ' <span class="task-badge moved">↪ odgođeno</span>';
        if (t.row.isLast && t.open) badge += ' <span class="task-badge last">⏳ zadnji mjesec</span>';
        html += '<li class="pp-task prio-' + task.prioritet + (t.open ? '' : ' done') + '">' +
            '<div class="pp-task-head"><div class="pp-task-title">' + (CATEGORY_ICONS[task.kategorija] || '📝') + ' ' + escapeHtml(task.naslov) + badge + '</div>' +
            '<div class="pp-task-status">' + status + '</div></div>' +
            '<div class="pp-task-desc">' + escapeHtml(task.opis || '') + '</div></li>';
    });
    html += '</ul>';
    el.innerHTML = html;
}

function renderPlantLast(item) {
    var el = document.getElementById('pp-last');
    if (!el) return;
    var logs = getPlantLogs(item.id);
    el.innerHTML = ['orezivanje', 'prskanje', 'gnojidba'].map(function (type) {
        var e = logs.find(function (x) { return x.type === type; });
        var info = LOG_TYPES[type];
        return '<div class="pp-last-row"><span>' + info.icon + ' ' + info.naziv + '</span>' +
            (e
                ? '<b title="' + escapeHtml(e.text || '') + '">' + escapeHtml(formatHrDate(e.date)) + ' <small>(' + escapeHtml(daysAgoText(e.date)) + ')</small></b>'
                : '<span class="pp-muted">nije zabilježeno</span>') +
            '</div>';
    }).join('');
}

function renderPlantLegacy(item) {
    var el = document.getElementById('pp-legacy');
    if (!el) return;
    var d = plantDetails[item.id] || {};
    var parts = [];
    if (d.orezano && d.orezano !== 'nepoznato') parts.push('Orezano: ' + d.orezano);
    if (d.gnojeno && d.gnojeno !== 'nepoznato') parts.push('Gnojeno: ' + d.gnojeno);
    if (d.spricano) parts.push('Špricano: ' + d.spricano);
    el.innerHTML = parts.length ? '🗂️ Raniji zapis: ' + escapeHtml(parts.join(' · ')) : '';
    el.classList.toggle('hidden', !parts.length);
}

function renderPlantLog(item) {
    var list = getPlantLogs(item.id);
    var countEl = document.getElementById('pp-log-count');
    if (countEl) countEl.textContent = list.length ? String(list.length) : '';
    var ul = document.getElementById('pp-log-list');
    if (!ul) return;
    var editable = canEdit();
    if (!list.length) {
        ul.innerHTML = '<li class="pp-muted">Još nema zapisa.' + (editable ? ' Dodaj prvi rad iznad.' : '') + '</li>';
        return;
    }
    ul.innerHTML = list.map(function (e) {
        var info = LOG_TYPES[e.type] || LOG_TYPES.ostalo;
        return '<li><span class="pp-log-icon">' + info.icon + '</span>' +
            '<div class="pp-log-main"><div><b>' + escapeHtml(info.naziv) + '</b> <small>' + escapeHtml(formatHrDate(e.date)) + '</small></div>' +
            (e.text ? '<div class="pp-log-text">' + escapeHtml(e.text) + '</div>' : '') + '</div>' +
            (editable ? '<button type="button" class="pp-x" data-act="log-del" data-id="' + escapeHtml(e.id) + '" title="Obriši zapis">✕</button>' : '') +
            '</li>';
    }).join('');
}

function renderPlantHarvest(item) {
    var estEl = document.getElementById('pp-harvest-est');
    var ul = document.getElementById('pp-harvest-list');
    if (!estEl || !ul) return;
    var type = normalizeType(item.treeType);
    var data = plantHarvests[item.id] || {};
    var years = Object.keys(data).sort().reverse();
    var est = type === 'ostalo' ? null : getYieldRangeKg(item);
    var estText = est ? Math.round(est.min) + '–' + Math.round(est.max) + ' kg' : null;

    var html = estText ? '<div>📊 Procjena za ovo stablo: <b>' + estText + '</b> godišnje</div>' : '<div class="pp-muted">Za ovu vrstu nema procjene uroda.</div>';
    if (years.length) {
        var total = years.reduce(function (s, y) { return s + Number(data[y].kg || 0); }, 0);
        html += '<div>🧺 Ukupno zabilježeno: <b>' + (Math.round(total * 10) / 10) + ' kg</b> u ' + years.length +
            (years.length === 1 ? ' godini' : ' godina') + ', prosjek <b>' + (Math.round(total / years.length * 10) / 10) + ' kg</b></div>';
    }
    estEl.innerHTML = html;

    var editable = canEdit();
    if (!years.length) {
        ul.innerHTML = '<li class="pp-muted">Još nema zabilježene berbe.</li>';
        return;
    }
    ul.innerHTML = years.map(function (y) {
        var h = data[y];
        var kg = Number(h.kg || 0);
        var cmp = '';
        if (est) {
            if (kg < est.min) cmp = '<span class="pp-cmp low">ispod procjene</span>';
            else if (kg > est.max) cmp = '<span class="pp-cmp high">iznad procjene</span>';
            else cmp = '<span class="pp-cmp ok">u okviru procjene</span>';
        }
        return '<li><b class="pp-year">' + escapeHtml(y) + '</b><span class="pp-kg">' + (Math.round(kg * 10) / 10) + ' kg</span>' + cmp +
            (h.note ? '<div class="pp-log-text">' + escapeHtml(h.note) + '</div>' : '') +
            (editable ? '<button type="button" class="pp-x" data-act="harvest-del" data-year="' + escapeHtml(y) + '" title="Obriši">✕</button>' : '') +
            '</li>';
    }).join('');
}

function renderPlantExtras(item) {
    if (!item) return;
    renderPlantHeader(item);
    renderPlantTasks(item);
    renderPlantUpcoming(item);
    renderPlantLast(item);
    renderPlantLegacy(item);
    renderPlantLog(item);
    renderPlantHarvest(item);
    var dateEl = document.getElementById('pp-log-date');
    if (dateEl && !dateEl.value) dateEl.value = todayIso();
    var yearEl = document.getElementById('pp-harvest-year');
    if (yearEl && !yearEl.value) yearEl.value = String(new Date().getFullYear());
}

function setPlantPanelTab(tab) {
    plantPanelTab = tab;
    document.querySelectorAll('.pp-tab').forEach(function (b) {
        var on = b.getAttribute('data-tab') === tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('.pp-pane').forEach(function (p) {
        p.classList.toggle('hidden', p.getAttribute('data-pane') !== tab);
    });
}

document.querySelectorAll('.pp-tab').forEach(function (b) {
    b.addEventListener('click', function () { setPlantPanelTab(b.getAttribute('data-tab')); });
});

var plantFormEl = document.getElementById('plant-form');
if (plantFormEl) {
    plantFormEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-act]');
        if (!btn || !selectedPlant) return;
        var item = allItemsById[selectedPlant.itemId];
        if (!item) return;
        var act = btn.getAttribute('data-act');

        if (act === 'open-tasks') {
            openTasks(item.treeType);
        } else if (act === 'tree-postpone' && canEdit()) {
            treePostponingKey = btn.getAttribute('data-key');
            renderPlantTasks(item);
        } else if (act === 'tree-postpone-cancel') {
            treePostponingKey = null;
            renderPlantTasks(item);
        } else if (act === 'tree-postpone-ok' && canEdit()) {
            var pk = btn.getAttribute('data-key');
            var sel = btn.parentElement.querySelector('.pp-postpone-month');
            var parts = sel.value.split('-');
            var nowP = new Date();
            treePostponingKey = null;
            setTreeTaskState(item.id, pk, {
                status: 'postponed',
                to: { year: Number(parts[0]), month: Number(parts[1]) },
                from: { year: nowP.getFullYear(), month: nowP.getMonth() + 1 },
                at: nowP.toISOString()
            });
        } else if (act === 'tree-skip' && canEdit()) {
            setTreeTaskState(item.id, btn.getAttribute('data-key'), { status: 'skipped', at: new Date().toISOString() });
        } else if (act === 'tree-undo-state' && canEdit()) {
            setTreeTaskState(item.id, btn.getAttribute('data-key'), null);
        } else if (act === 'tree-undo-log' && canEdit()) {
            removePlantLog(item.id, btn.getAttribute('data-log'));
        } else if (act === 'task-done' && canEdit()) {
            var key = btn.getAttribute('data-key');
            var row = (treeTasks(item) || []).map(function (t) { return t.row; }).find(function (r) { return r.key === key; });
            if (!row) return;
            addPlantLog(item.id, {
                date: todayIso(),
                type: TASK_CATEGORY_TO_LOG[row.task.kategorija] || 'ostalo',
                text: row.task.naslov,
                taskKey: key
            });
        } else if (act === 'log-del' && canEdit()) {
            var logId = btn.getAttribute('data-id');
            askConfirm('Obrisati zapis?', 'Zapis će biti uklonjen iz dnevnika ovog stabla.', 'Obriši').then(function (ok) {
                if (ok) removePlantLog(item.id, logId);
            });
        } else if (act === 'harvest-del' && canEdit()) {
            var year = btn.getAttribute('data-year');
            askConfirm('Obrisati berbu?', 'Obrisati zapis berbe za ' + year + '. godinu?', 'Obriši').then(function (ok) {
                if (!ok) return;
                var data = Object.assign({}, plantHarvests[item.id] || {});
                delete data[year];
                if (Object.keys(data).length) plantHarvests[item.id] = data;
                else delete plantHarvests[item.id];
                savePlantHarvests();
                afterPlantDataChange();
            });
        }
    });
}

var plantLogForm = document.getElementById('pp-log-form');
if (plantLogForm) {
    plantLogForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!selectedPlant || !canEdit()) return;
        var date = document.getElementById('pp-log-date').value || todayIso();
        var textEl = document.getElementById('pp-log-text');
        addPlantLog(selectedPlant.itemId, {
            date: date,
            type: document.getElementById('pp-log-type').value,
            text: textEl.value.trim()
        });
        textEl.value = '';
    });
}

var plantHarvestForm = document.getElementById('pp-harvest-form');
if (plantHarvestForm) {
    plantHarvestForm.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!selectedPlant || !canEdit()) return;
        var year = String(parseInt(document.getElementById('pp-harvest-year').value, 10) || new Date().getFullYear());
        var kgRaw = document.getElementById('pp-harvest-kg').value;
        var kg = Number(kgRaw);
        if (kgRaw === '' || !isFinite(kg) || kg < 0) {
            alert('Upiši količinu u kg (npr. 12.5).');
            return;
        }
        var noteEl = document.getElementById('pp-harvest-note');
        var id = selectedPlant.itemId;
        var data = Object.assign({}, plantHarvests[id] || {});
        data[year] = { kg: kg, note: noteEl.value.trim(), at: new Date().toISOString() };
        plantHarvests[id] = data;
        savePlantHarvests();
        document.getElementById('pp-harvest-kg').value = '';
        noteEl.value = '';
        afterPlantDataChange();
    });
}

// ----- oznake zadataka (❗) i filter na karti --------------------------------

var taskBadgeLayer = L.layerGroup().addTo(map);
var mapFilter = { types: {}, state: 'all', search: '', badges: 'important' }; // badges: important | all | off
var mapRefreshTimer = null;

function scheduleMapRefresh() {
    if (mapRefreshTimer) clearTimeout(mapRefreshTimer);
    mapRefreshTimer = setTimeout(function () {
        mapRefreshTimer = null;
        applyMapFilter();
    }, 60);
}

function normalizeSearch(text) {
    return String(text || '').toLowerCase()
        .replace(/[šś]/g, 's').replace(/đ/g, 'd').replace(/[čć]/g, 'c').replace(/ž/g, 'z');
}

function filterActive() {
    return Object.keys(mapFilter.types).length > 0 || mapFilter.state !== 'all' || !!mapFilter.search;
}

function itemMatchesFilter(item) {
    var type = normalizeType(item.treeType);
    if (Object.keys(mapFilter.types).length && !mapFilter.types[type]) return false;
    if (mapFilter.search) {
        var q = normalizeSearch(mapFilter.search);
        if (normalizeSearch(item.name).indexOf(q) === -1 && normalizeSearch(item.id).indexOf(q) === -1) return false;
    }
    if (mapFilter.state === 'tasks' && !treeAlertLevel(item)) return false;
    if (mapFilter.state === 'notpruned') {
        var year = String(new Date().getFullYear());
        var pruned = getPlantLogs(item.id).some(function (e) { return e.type === 'orezivanje' && String(e.date).slice(0, 4) === year; });
        if (pruned) return false;
    }
    if (mapFilter.state === 'nolog' && getPlantLogs(item.id).length) return false;
    return true;
}

function allMapItems() {
    return baseItems.concat(userItems).filter(function (i) { return i && i.id && allMarkersById[i.id]; });
}

function applyMapFilter() {
    var items = allMapItems();
    var active = filterActive();
    var shown = 0;
    items.forEach(function (item) {
        var match = !active || itemMatchesFilter(item);
        if (match) shown++;
        var marker = allMarkersById[item.id];
        marker.setOpacity(match ? 1 : 0.15);
        var el = marker.getElement();
        if (el) el.classList.toggle('marker-filtered-out', !match);
        item._filterMatch = match;
    });
    var countEl = document.getElementById('filter-count');
    if (countEl) countEl.textContent = 'Prikazano ' + shown + ' od ' + items.length;
    var chip = document.getElementById('filter-chip');
    if (chip) {
        chip.classList.toggle('hidden', !active);
        chip.textContent = '🔍 ' + shown + ' / ' + items.length + '  ✕';
    }
    refreshTaskBadges();
}

function refreshTaskBadges() {
    taskBadgeLayer.clearLayers();
    if (mapFilter.badges === 'off' || !tasksData) return;
    allMapItems().forEach(function (item) {
        if (item._filterMatch === false) return;
        var marker = allMarkersById[item.id];
        var el = marker.getElement();
        if (el && el.classList.contains('vine-dot-wrapper')) return; // sitne točke vinove loze
        var level = treeAlertLevel(item);
        if (!level || (mapFilter.badges === 'important' && level !== 1)) return;
        var ll = marker.getLatLng();
        L.marker(ll, {
            icon: L.divIcon({
                className: 'task-flag-wrap',
                html: '<span class="task-flag p' + level + '" title="' + (level === 1 ? 'Važan zadatak ovaj mjesec' : 'Zadatak ovaj mjesec') + '">!</span>',
                iconSize: [16, 16],
                iconAnchor: [-4, Math.round(FULL_ICON_SIZE + 6)]
            }),
            interactive: false,
            keyboard: false,
            zIndexOffset: 3000
        }).addTo(taskBadgeLayer);
    });
}

function renderFilterTypes() {
    var el = document.getElementById('filter-types');
    if (!el) return;
    var counts = countTreesByType();
    var types = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    el.innerHTML = types.map(function (t) {
        var on = !!mapFilter.types[t];
        return '<button type="button" class="fp-type' + (on ? ' active' : '') + '" data-type="' + escapeHtml(t) + '" aria-pressed="' + on + '">' +
            speciesIconHtml(t) + escapeHtml(speciesName(t)) + ' <b>' + counts[t] + '</b></button>';
    }).join('');
}

var filterPanelEl = document.getElementById('filter-panel');

function openFilterPanel() {
    if (!filterPanelEl) return;
    setMenuOpen(false);
    renderFilterTypes();
    filterPanelEl.classList.remove('hidden');
    loadTasks().then(function () { renderFilterTypes(); scheduleMapRefresh(); }).catch(function () {});
}

function closeFilterPanel() {
    if (filterPanelEl) filterPanelEl.classList.add('hidden');
}

if (filterPanelEl) {
    document.getElementById('open-filter').addEventListener('click', openFilterPanel);
    document.getElementById('close-filter').addEventListener('click', closeFilterPanel);
    document.getElementById('filter-chip').addEventListener('click', openFilterPanel);
    document.getElementById('filter-types').addEventListener('click', function (event) {
        var b = event.target.closest('.fp-type');
        if (!b) return;
        var t = b.getAttribute('data-type');
        if (mapFilter.types[t]) delete mapFilter.types[t];
        else mapFilter.types[t] = true;
        renderFilterTypes();
        scheduleMapRefresh();
    });
    filterPanelEl.addEventListener('change', function (event) {
        if (event.target.name === 'filter-state') {
            mapFilter.state = event.target.value;
            scheduleMapRefresh();
        } else if (event.target.id === 'filter-badges') {
            mapFilter.badges = event.target.value;
            scheduleMapRefresh();
        }
    });
    var searchEl = document.getElementById('filter-search');
    searchEl.addEventListener('input', function () {
        mapFilter.search = searchEl.value.trim();
        scheduleMapRefresh();
    });
    searchEl.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        var hits = allMapItems().filter(itemMatchesFilter);
        if (!hits.length) return;
        var item = hits[0];
        map.setView(allMarkersById[item.id].getLatLng(), Math.max(map.getZoom(), 1));
        openPlantPanel(item, userItems.some(function (u) { return u.id === item.id; }));
    });
    document.getElementById('filter-reset').addEventListener('click', function () {
        mapFilter.types = {};
        mapFilter.state = 'all';
        mapFilter.search = '';
        searchEl.value = '';
        var allRadio = filterPanelEl.querySelector('input[name="filter-state"][value="all"]');
        if (allRadio) allRadio.checked = true;
        renderFilterTypes();
        scheduleMapRefresh();
    });
}

// Nakon promjena u rasporedu osvježi oznake i otvoreni panel
function onTasksChanged() {
    afterPlantDataChange();
}

// ---------------------------------------------------------------------------
// Raspored: filter po vrsti + budući zadaci u panelu stabla
// ---------------------------------------------------------------------------
var tasksSpeciesFilter = '';

function filterTasksBySpecies(view) {
    if (!tasksSpeciesFilter) return view;
    var keep = function (r) { return (r.task.vrste || []).indexOf(tasksSpeciesFilter) !== -1; };
    return { active: view.active.filter(keep), away: view.away.filter(keep) };
}

function renderTasksSpeciesSelect() {
    var sel = document.getElementById('tasks-species');
    if (!sel) return;
    var counts = countTreesByType();
    var types = Object.keys(counts).filter(function (t) {
        return tasksData && tasksData.zadaci.some(function (z) { return (z.vrste || []).indexOf(t) !== -1; });
    }).sort(function (a, b) { return speciesName(a).localeCompare(speciesName(b), 'hr'); });
    sel.innerHTML = '<option value="">Sve vrste</option>' + types.map(function (t) {
        return '<option value="' + escapeHtml(t) + '"' + (t === tasksSpeciesFilter ? ' selected' : '') + '>' +
            escapeHtml(speciesName(t)) + ' (' + counts[t] + ')</option>';
    }).join('');
}

var tasksSpeciesSelect = document.getElementById('tasks-species');
if (tasksSpeciesSelect) {
    tasksSpeciesSelect.addEventListener('change', function () {
        tasksSpeciesFilter = tasksSpeciesSelect.value;
        renderTasks();
    });
}

// Zadaci za vrstu stabla u idućih 12 mjeseci (bez tekućeg), po mjesecima
function renderPlantUpcoming(item) {
    var el = document.getElementById('pp-upcoming');
    if (!el) return;
    if (!tasksData) { el.innerHTML = ''; return; }
    var type = normalizeType(item.treeType);
    var now = new Date();
    var month = now.getMonth() + 1;
    var groups = [];
    for (var i = 1; i <= 12; i++) {
        var m = ((month - 1 + i) % 12) + 1;
        var yy = now.getFullYear() + Math.floor((month - 1 + i) / 12);
        var tasks = tasksData.zadaci.filter(function (z) {
            if ((z.vrste || []).indexOf(type) === -1) return false;
            if ((z.mjeseci || []).indexOf(m) === -1) return false;
            if (z.godina && z.godina !== yy) return false;
            // zadatak koji traje i ovaj mjesec ne ponavljaj u idućem
            var prev = m === 1 ? 12 : m - 1;
            return i === 1 ? z.mjeseci.indexOf(month) === -1 : z.mjeseci.indexOf(prev) === -1;
        });
        if (tasks.length) groups.push({ month: m, tasks: tasks });
    }
    if (!groups.length) { el.innerHTML = ''; return; }
    var limit = 4;
    var html = '<h4 class="pp-h">📅 Sljedeći zadaci</h4><ul class="pp-upcoming">';
    groups.forEach(function (g, idx) {
        html += '<li class="' + (idx >= limit ? 'pp-more hidden' : '') + '"><span class="pp-up-month">' + escapeHtml(MONTH_NAMES[g.month - 1]) + '</span><span>' +
            g.tasks.map(function (z) {
                return '<span class="pp-up-task prio-' + z.prioritet + '">' + (CATEGORY_ICONS[z.kategorija] || '📝') + ' ' + escapeHtml(z.naslov) + '</span>';
            }).join('') + '</span></li>';
    });
    html += '</ul>';
    if (groups.length > limit) html += '<button type="button" class="link-btn" data-act="upcoming-more">Prikaži cijelu godinu (' + groups.length + ' mj.)</button> · ';
    html += '<button type="button" class="link-btn" data-act="open-tasks">🗓️ Raspored za ovu vrstu</button>';
    el.innerHTML = html;
}

document.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-act="upcoming-more"]');
    if (!btn) return;
    document.querySelectorAll('#pp-upcoming .pp-more').forEach(function (li) { li.classList.remove('hidden'); });
    btn.remove();
});

// Napredak zadatka po stablima (samo za tekući mjesec)
function taskProgressHtml(r) {
    var now = new Date();
    if (!tasksView || tasksView.year !== now.getFullYear() || tasksView.month !== now.getMonth() + 1) return '';
    if (!r.species || !r.species.length || typeof speciesTreeProgress !== 'function') return '';
    var p = speciesTreeProgress(r);
    if (!p || !p.total) return '';
    var parts = ['🌳 ' + p.handled + '/' + p.total + ' stabla napravljeno'];
    if (p.skipped) parts.push(p.skipped + ' preskočeno');
    if (p.postponed) parts.push(p.postponed + ' odgođeno');
    return '<div class="task-progress">' + escapeHtml(parts.join(' · ')) + '</div>';
}

// Izbornik lijevo je na računalu otvoren prema zadanim postavkama (na mobitelu zatvoren, da ne pokriva kartu)
if (window.innerWidth >= 700) setMenuOpen(true);

// ---------------------------------------------------------------------------
// Vlastiti zadaci u rasporedu (npr. sanirati pješčanik, pospremiti trampolin)
// ---------------------------------------------------------------------------
function mergeCustomTasks() {
    if (!tasksData || !tasksBaseZadaci) return;
    var custom = Object.keys(customTasks).map(function (id) {
        return Object.assign({ kategorija: 'vlastito', vrste: [], prioritet: 2 }, customTasks[id], { id: id, custom: true });
    });
    tasksData.zadaci = tasksBaseZadaci.concat(custom);
}

function saveCustomTasks() {
    if (storageMode === 'server') queueServerSync('ctask', customTasks);
    mergeCustomTasks();
    renderTasks();
    onTasksChanged();
}

function addCustomTask(task) {
    if (!canEdit()) return;
    var id = 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    customTasks[id] = task;
    saveCustomTasks();
}

function removeCustomTask(id) {
    if (!canEdit()) return;
    delete customTasks[id];
    saveCustomTasks();
}

function customTaskFormHtml() {
    var y = tasksView.year;
    var m = tasksView.month;
    var counts = countTreesByType();
    var speciesOpts = Object.keys(counts).sort(function (a, b) { return speciesName(a).localeCompare(speciesName(b), 'hr'); })
        .map(function (t) { return '<option value="' + escapeHtml(t) + '">' + escapeHtml(speciesName(t)) + '</option>'; }).join('');
    return '<form id="custom-task-form" class="custom-task-form" autocomplete="off">' +
        '<b>📌 Novi vlastiti zadatak</b>' +
        '<input id="ct-title" type="text" maxlength="100" placeholder="Naziv (npr. Sanirati pješčanik)">' +
        '<input id="ct-desc" type="text" maxlength="300" placeholder="Opis (nije obavezno)">' +
        '<div class="ct-row">' +
        '<label>Mjesec <select id="ct-month">' + MONTH_NAMES.map(function (n, i) {
            return '<option value="' + (i + 1) + '"' + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>';
        }).join('') + '</select></label>' +
        '<label>Godina <select id="ct-year"><option value="' + y + '">Samo ' + y + '.</option><option value="' + (y + 1) + '">Samo ' + (y + 1) + '.</option><option value="0">Svake godine</option></select></label>' +
        '</div><div class="ct-row">' +
        '<label>Prioritet <select id="ct-prio"><option value="1">🔴 Važno</option><option value="2" selected>🟠 Redovno</option><option value="3">🟢 Kad stigneš</option></select></label>' +
        '<label>Vrsta <select id="ct-species"><option value="">Bez vrste (općenito)</option>' + speciesOpts + '</select></label>' +
        '</div>' +
        '<div id="ct-error" class="add-tree-error hidden" role="alert"></div>' +
        '<div class="ct-actions"><button type="button" id="ct-cancel" class="btn-secondary">Odustani</button><button type="submit" class="btn-primary">Dodaj zadatak</button></div>' +
        '</form>';
}

var addCustomTaskBtn = document.getElementById('add-custom-task');
if (addCustomTaskBtn) {
    addCustomTaskBtn.addEventListener('click', function () {
        if (!canEdit() || !tasksView) return;
        var listEl = document.getElementById('tasks-list');
        if (document.getElementById('custom-task-form')) return;
        listEl.insertAdjacentHTML('afterbegin', customTaskFormHtml());
        syncCustomTaskYear();
        document.getElementById('ct-title').focus();
    });
}

// Ako je odabrani mjesec ove godine već prošao, predloži sljedeću godinu
function syncCustomTaskYear() {
    var monthEl = document.getElementById('ct-month');
    var yearEl = document.getElementById('ct-year');
    if (!monthEl || !yearEl) return;
    var now = new Date();
    var m = Number(monthEl.value);
    var firstYear = Number(yearEl.options[0].value);
    if (yearEl.value === '0') return;
    var wanted = (firstYear === now.getFullYear() && m < now.getMonth() + 1) ? firstYear + 1 : firstYear;
    yearEl.value = String(wanted);
}

document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'ct-month') syncCustomTaskYear();
});

document.addEventListener('click', function (event) {
    if (event.target && event.target.id === 'ct-cancel') {
        var f = document.getElementById('custom-task-form');
        if (f) f.remove();
    }
});

document.addEventListener('submit', function (event) {
    if (!event.target || event.target.id !== 'custom-task-form') return;
    event.preventDefault();
    var title = document.getElementById('ct-title').value.trim();
    var errEl = document.getElementById('ct-error');
    if (!title) {
        errEl.textContent = 'Upiši naziv zadatka.';
        errEl.classList.remove('hidden');
        return;
    }
    var month = Number(document.getElementById('ct-month').value);
    var year = Number(document.getElementById('ct-year').value);
    var species = document.getElementById('ct-species').value;
    var task = {
        naslov: title,
        opis: document.getElementById('ct-desc').value.trim(),
        mjeseci: [month],
        prioritet: Number(document.getElementById('ct-prio').value),
        kategorija: 'vlastito',
        vrste: species ? [species] : [],
        at: new Date().toISOString()
    };
    if (year) task.godina = year;
    addCustomTask(task);
    // prikaži mjesec u koji je zadatak dodan
    tasksView = { year: year || tasksView.year, month: month };
    renderTasks();
});

// ---------------------------------------------------------------------------
// Novčanik: troškovi i prihodi (samo admin, zasebni API /api/wallet)
// ---------------------------------------------------------------------------
var WALLET_API_URL = 'api/wallet';
var WALLET_CATEGORIES = {
    trosak: [
        ['sadnice', '🌱 Sadnice i sjeme'],
        ['zastita', '🧴 Zaštita (sredstva)'],
        ['gnojivo', '🌿 Gnojivo / kompost'],
        ['alat', '🛠️ Alat i oprema'],
        ['voda', '💧 Voda'],
        ['rad', '👷 Rad i usluge'],
        ['ostalo', '📦 Ostalo']
    ],
    prihod: [
        ['voce', '🍎 Prodaja voća'],
        ['povrce', '🥕 Prodaja povrća'],
        ['preradevine', '🍯 Prerađevine (sok, rakija, pekmez)'],
        ['poticaji', '🏛️ Poticaji'],
        ['ostalo', '📦 Ostalo']
    ]
};
var walletModal = document.getElementById('wallet-modal');
var walletEntries = null;
var walletYear = new Date().getFullYear();

function formatEur(n) {
    return Number(n || 0).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function walletCategoryLabel(kind, cat) {
    var list = WALLET_CATEGORIES[kind] || [];
    var found = list.find(function (c) { return c[0] === cat; });
    return found ? found[1] : '📦 ' + (cat || 'Ostalo');
}

function walletRequest(method, body) {
    if (demoMode) return demoWalletRequest(method, body);
    return fetch(WALLET_API_URL, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store'
    }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
            if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
            return data;
        });
    });
}

function fillWalletCategories() {
    var kind = (document.querySelector('input[name="wallet-kind"]:checked') || {}).value || 'trosak';
    var sel = document.getElementById('wallet-category');
    sel.innerHTML = WALLET_CATEGORIES[kind].map(function (c) {
        return '<option value="' + c[0] + '">' + c[1] + '</option>';
    }).join('');
}

function renderWallet() {
    document.getElementById('wallet-year').textContent = String(walletYear);
    var listEl = document.getElementById('wallet-list');
    var sumEl = document.getElementById('wallet-summary');
    var brEl = document.getElementById('wallet-breakdown');
    if (!walletEntries) {
        listEl.innerHTML = '<li class="pp-muted">Učitavanje…</li>';
        sumEl.innerHTML = '';
        brEl.innerHTML = '';
        return;
    }
    var yearEntries = walletEntries.filter(function (e) { return String(e.date).slice(0, 4) === String(walletYear); });
    var entries = yearEntries.filter(function (e) { return !e.planned; });
    var planned = yearEntries.filter(function (e) { return e.planned; });
    var income = 0;
    var cost = 0;
    var plannedIncome = 0;
    var plannedCost = 0;
    var byCat = {};
    planned.forEach(function (e) {
        if (e.kind === 'prihod') plannedIncome += e.amount; else plannedCost += e.amount;
    });
    entries.forEach(function (e) {
        if (e.kind === 'prihod') income += e.amount; else cost += e.amount;
        var k = e.kind + '|' + e.category;
        byCat[k] = (byCat[k] || 0) + e.amount;
    });
    var balance = income - cost;
    sumEl.innerHTML =
        '<div class="ws-card cost"><span>Troškovi</span><b>' + formatEur(cost) + '</b></div>' +
        '<div class="ws-card income"><span>Prihodi</span><b>' + formatEur(income) + '</b></div>' +
        '<div class="ws-card ' + (balance >= 0 ? 'profit' : 'loss') + '"><span>' + (balance >= 0 ? 'Dobit' : 'Gubitak') + '</span><b>' +
        (balance >= 0 ? '+' : '−') + formatEur(Math.abs(balance)) + '</b></div>';
    var after = balance + plannedIncome - plannedCost;
    sumEl.innerHTML +=
        '<div class="ws-card planned cost"><span>🕒 Planirani troškovi</span><b>' + formatEur(plannedCost) + '</b></div>' +
        '<div class="ws-card planned income"><span>🕒 Planirani prihodi</span><b>' + formatEur(plannedIncome) + '</b></div>' +
        '<div class="ws-card planned ' + (after >= 0 ? 'profit' : 'loss') + '"><span>Bilanca nakon planiranog</span><b>' +
        (after >= 0 ? '+' : '−') + formatEur(Math.abs(after)) + '</b></div>';

    var plannedBox = document.getElementById('wallet-planned-box');
    if (plannedBox) {
        plannedBox.innerHTML = planned.length ? '<h4 class="pp-h">🕒 Planirano</h4><ul class="wallet-list planned-list">' + planned.map(function (e) {
            return '<li class="' + e.kind + ' planned"><div class="wl-main"><div><b>' + escapeHtml(walletCategoryLabel(e.kind, e.category)) + '</b> <small>' +
                escapeHtml(formatHrDate(e.date)) + '</small></div>' + (e.note ? '<div class="pp-log-text">' + escapeHtml(e.note) + '</div>' : '') + '</div>' +
                '<span class="wl-amount ' + e.kind + '">' + (e.kind === 'prihod' ? '+' : '−') + formatEur(e.amount) + '</span>' +
                '<button type="button" class="wl-realize" data-act="wallet-realize" data-id="' + escapeHtml(e.id) + '" title="Označi kao plaćeno / primljeno (današnji datum)">✓ Ostvareno</button>' +
                '<button type="button" class="pp-x" data-act="wallet-del" data-id="' + escapeHtml(e.id) + '" title="Obriši">✕</button></li>';
        }).join('') + '</ul>' : '';
    }

    var keys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
    var max = keys.reduce(function (mx, k) { return Math.max(mx, byCat[k]); }, 0);
    brEl.innerHTML = keys.length ? '<h4 class="pp-h">Po kategorijama</h4><ul class="wallet-bars">' + keys.map(function (k) {
        var parts = k.split('|');
        return '<li><span class="wb-label">' + escapeHtml(walletCategoryLabel(parts[0], parts[1])) + '</span>' +
            '<span class="wb-bar"><i class="' + parts[0] + '" style="width:' + Math.max(3, Math.round(byCat[k] / max * 100)) + '%"></i></span>' +
            '<span class="wb-val ' + parts[0] + '">' + (parts[0] === 'prihod' ? '+' : '−') + formatEur(byCat[k]) + '</span></li>';
    }).join('') + '</ul>' : '';

    if (!entries.length) {
        listEl.innerHTML = '<li class="pp-muted">Za ' + walletYear + '. još nema ' + (planned.length ? 'ostvarenih ' : '') + 'zapisa.</li>';
        return;
    }
    listEl.innerHTML = entries.map(function (e) {
        return '<li class="' + e.kind + '"><div class="wl-main"><div><b>' + escapeHtml(walletCategoryLabel(e.kind, e.category)) + '</b> <small>' +
            escapeHtml(formatHrDate(e.date)) + '</small></div>' + (e.note ? '<div class="pp-log-text">' + escapeHtml(e.note) + '</div>' : '') + '</div>' +
            '<span class="wl-amount ' + e.kind + '">' + (e.kind === 'prihod' ? '+' : '−') + formatEur(e.amount) + '</span>' +
            '<button type="button" class="pp-x" data-act="wallet-del" data-id="' + escapeHtml(e.id) + '" title="Obriši">✕</button></li>';
    }).join('');
}

function loadWallet() {
    walletEntries = null;
    renderWallet();
    return walletRequest('GET').then(function (data) {
        walletEntries = data.entries || [];
        renderWallet();
    }).catch(function (error) {
        document.getElementById('wallet-list').innerHTML = '<li class="pp-muted">⚠️ ' + escapeHtml(error.message) + '</li>';
    });
}

function openWallet() {
    if (!walletModal || !isAdminUser) return;
    setMenuOpen(false);
    walletYear = new Date().getFullYear();
    document.getElementById('wallet-date').value = todayIso();
    fillWalletCategories();
    walletModal.classList.remove('hidden');
    loadWallet();
}

function closeWallet() {
    if (walletModal) walletModal.classList.add('hidden');
}

if (walletModal) {
    document.getElementById('open-wallet').addEventListener('click', openWallet);
    document.getElementById('close-wallet').addEventListener('click', closeWallet);
    walletModal.addEventListener('click', function (event) { if (event.target === walletModal) closeWallet(); });
    document.getElementById('wallet-prev').addEventListener('click', function () { walletYear--; renderWallet(); });
    document.getElementById('wallet-next').addEventListener('click', function () { walletYear++; renderWallet(); });
    document.querySelectorAll('input[name="wallet-kind"]').forEach(function (r) { r.addEventListener('change', fillWalletCategories); });

    document.getElementById('wallet-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var errEl = document.getElementById('wallet-error');
        errEl.classList.add('hidden');
        var amount = Number(document.getElementById('wallet-amount').value);
        if (!isFinite(amount) || amount <= 0) {
            errEl.textContent = 'Upiši iznos veći od 0.';
            errEl.classList.remove('hidden');
            return;
        }
        var entry = {
            id: 'w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            date: document.getElementById('wallet-date').value || todayIso(),
            kind: document.querySelector('input[name="wallet-kind"]:checked').value,
            amount: amount,
            category: document.getElementById('wallet-category').value,
            note: document.getElementById('wallet-note').value.trim(),
            planned: document.getElementById('wallet-planned').checked
        };
        var submitBtn = event.target.querySelector('button[type=submit]');
        submitBtn.disabled = true;
        walletRequest('POST', { action: 'add', entry: entry }).then(function (data) {
            walletEntries = [data.entry].concat(walletEntries || []).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
            walletYear = Number(String(entry.date).slice(0, 4));
            document.getElementById('wallet-amount').value = '';
            document.getElementById('wallet-note').value = '';
            document.getElementById('wallet-planned').checked = false;
            renderWallet();
        }).catch(function (error) {
            errEl.textContent = 'Spremanje nije uspjelo: ' + error.message;
            errEl.classList.remove('hidden');
        }).then(function () { submitBtn.disabled = false; });
    });

    document.getElementById('wallet-planned-box').addEventListener('click', function (event) {
        var btn = event.target.closest('[data-act="wallet-realize"]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        var entry = (walletEntries || []).find(function (e) { return e.id === id; });
        if (!entry) return;
        var updated = Object.assign({}, entry, { planned: false, date: todayIso() });
        btn.disabled = true;
        walletRequest('POST', { action: 'update', entry: updated }).then(function (data) {
            walletEntries = walletEntries.map(function (e) { return e.id === id ? data.entry : e; });
            walletYear = Number(String(updated.date).slice(0, 4));
            renderWallet();
        }).catch(function (error) {
            btn.disabled = false;
            alert('Spremanje nije uspjelo: ' + error.message);
        });
    });

    document.getElementById('wallet-modal').addEventListener('click', function (event) {
        var btn = event.target.closest('[data-act="wallet-del"]');
        if (!btn) return;
        var id = btn.getAttribute('data-id');
        askConfirm('Obrisati zapis?', 'Zapis će biti trajno obrisan iz novčanika.', 'Obriši').then(function (ok) {
            if (!ok) return;
            walletRequest('POST', { action: 'delete', id: id }).then(function () {
                walletEntries = (walletEntries || []).filter(function (e) { return e.id !== id; });
                renderWallet();
            }).catch(function (error) { alert('Brisanje nije uspjelo: ' + error.message); });
        });
    });
}

// Abecedni redoslijed (hrvatska abeceda); "Ostalo" uvijek na kraju
function sortByName(list) {
    return (list || []).slice().sort(function (a, b) { return String(a.naziv).localeCompare(String(b.naziv), 'hr'); });
}

function sortedFruitEntries() {
    var list = sortByName(encyclopediaData ? encyclopediaData.vrste : []);
    var other = list.filter(function (v) { return v.id === 'ostalo'; });
    return list.filter(function (v) { return v.id !== 'ostalo'; }).concat(other);
}

// ---------------------------------------------------------------------------
// Enciklopedija: "Špricanje i pripravci" – koji pripravci trebaju za vrste u voćnjaku
// ---------------------------------------------------------------------------
var SPRAY_PAGE_ID = 'spricanje';

function sprayProblems() {
    // Svi problemi vrsta koje su na karti (ako je karta prazna: sve vrste)
    var counts = countTreesByType();
    var species = encyclopediaData.vrste.filter(function (v) { return v.id !== 'ostalo' && counts[v.id] > 0; });
    if (!species.length) species = encyclopediaData.vrste.filter(function (v) { return v.id !== 'ostalo'; });
    var list = [];
    species.forEach(function (v) {
        (v.bolesti || []).forEach(function (b) { list.push({ species: v, problem: b, tip: 'bolesti' }); });
        (v.stetnici || []).forEach(function (b) { list.push({ species: v, problem: b, tip: 'stetnici' }); });
    });
    return { species: species, problems: list.filter(function (p) { return p.problem.naziv !== 'Rijetko'; }) };
}

function matchesPrep(prep, p) {
    var text = (p.problem.rjesenje || '');
    if (!new RegExp(prep.kljuc, 'i').test(text)) return false;
    if (prep.iskljuci && new RegExp(prep.iskljuci, 'i').test(text)) return false;
    if (prep.tip === 'bolesti' && p.tip !== 'bolesti' && prep.id !== 'bakar' && prep.id !== 'sumpor') return false;
    if (prep.tip === 'stetnici' && p.tip !== 'stetnici') return false;
    return true;
}

function renderSprayPage() {
    var cfg = encyclopediaData.meta && encyclopediaData.meta.pripravci;
    if (!cfg) {
        encyclopediaArticleEl.innerHTML = '<p class="encyclopedia-empty">Nema podataka o pripravcima.</p>';
        return;
    }
    var data = sprayProblems();
    var total = data.problems.length;
    var sprayRe = new RegExp(cfg.prskanjeKljuc, 'i');
    var noSpray = data.problems.filter(function (p) { return !sprayRe.test(p.problem.rjesenje || ''); });

    var preps = cfg.popis.map(function (prep) {
        var hits = data.problems.filter(function (p) { return matchesPrep(prep, p); });
        return { prep: prep, hits: hits };
    });
    var basic = preps.filter(function (x) { return x.prep.osnovni; });
    var basicHits = data.problems.filter(function (p) { return basic.some(function (x) { return x.hits.indexOf(p) !== -1; }); }).length;

    var pct = function (n) { return total ? Math.round(n / total * 100) : 0; };
    var html = '<header class="enc-head"><span class="enc-emoji" style="font-size:38px">🧴</span>' +
        '<div><h2>Špricanje i pripravci</h2><div class="enc-onmap">Za ' + data.species.length + ' vrsta u tvom voćnjaku · ' + total + ' mogućih problema</div></div></header>';

    html += '<div class="spray-summary">' +
        '<div class="spray-big"><b>' + basic.length + '</b><span>osnovna pripravka</span></div>' +
        '<div class="spray-big"><b>' + pct(basicHits) + ' %</b><span>problema pokrivaju bakar, ulje i sumpor (' + basicHits + ' od ' + total + ')</span></div>' +
        '<div class="spray-big ok"><b>' + pct(noSpray.length) + ' %</b><span>problema rješava se bez prskanja (' + noSpray.length + ')</span></div>' +
        '</div>';
    html += '<p class="spray-intro">' + escapeHtml(cfg.uvod) + '</p>';

    preps.forEach(function (x) {
        var prep = x.prep;
        // grupiraj pogođene probleme po vrsti
        var bySpecies = {};
        x.hits.forEach(function (p) {
            (bySpecies[p.species.id] = bySpecies[p.species.id] || { species: p.species, names: [] }).names.push(p.problem.naziv);
        });
        var groups = Object.keys(bySpecies).map(function (k) { return bySpecies[k]; })
            .sort(function (a, b) { return a.species.naziv.localeCompare(b.species.naziv, 'hr'); });
        html += '<section class="spray-card' + (prep.osnovni ? ' basic' : '') + '">' +
            '<div class="spray-head"><span class="spray-emoji">' + prep.emoji + '</span><div><h3>' + escapeHtml(prep.naziv) +
            (prep.osnovni ? ' <span class="task-badge first">osnovni</span>' : ' <span class="task-badge cond">po potrebi</span>') + '</h3>' +
            (prep.id !== 'pomagala' || x.hits.length
                ? '<div class="spray-cover"><span class="spray-bar"><i style="width:' + Math.max(2, pct(x.hits.length)) + '%"></i></span>' +
                  (prep.id === 'pomagala' ? 'koristi se kod ' : 'pomaže kod ') + x.hits.length + ' od ' + total + ' problema (' + pct(x.hits.length) + ' %)</div>'
                : '') +
            '</div></div>' +
            '<div class="enc-problem-row"><span class="enc-tag see">Što je</span><p>' + escapeHtml(prep.stoJe) + '</p></div>' +
            '<div class="enc-problem-row"><span class="enc-tag fix">Kada</span><p>' + escapeHtml(prep.kada) + '</p></div>' +
            '<div class="enc-problem-row"><span class="enc-tag warn">Pazi</span><p>' + escapeHtml(prep.pazi) + '</p></div>' +
            (groups.length
                ? '<details class="spray-list"><summary>Kod kojih problema (' + x.hits.length + ')</summary><ul>' + groups.map(function (g) {
                    return '<li>' + encyclopediaIconHtml(g.species, 16) + ' <b>' + escapeHtml(g.species.naziv) + ':</b> ' + escapeHtml(g.names.join(', ')) + '</li>';
                }).join('') + '</ul></details>'
                : '') +
            '</section>';
    });

    if (noSpray.length) {
        html += '<section class="spray-card ok"><div class="spray-head"><span class="spray-emoji">✂️</span><div><h3>Bez prskanja</h3>' +
            '<div class="spray-cover">rezidba, čišćenje lišća i mumija, ručno uklanjanje, dobar uzgoj</div></div></div>' +
            '<details class="spray-list"><summary>Problemi koji se rješavaju bez pripravaka (' + noSpray.length + ')</summary><ul>' +
            noSpray.map(function (p) {
                return '<li>' + encyclopediaIconHtml(p.species, 16) + ' <b>' + escapeHtml(p.species.naziv) + ':</b> ' + escapeHtml(p.problem.naziv) + '</li>';
            }).join('') + '</ul></details></section>';
    }

    encyclopediaArticleEl.innerHTML = html;
    encyclopediaArticleEl.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Dnevnik: izbor bolesti / štetnika iz enciklopedije
// ---------------------------------------------------------------------------
function speciesEntry(typeId) {
    if (!encyclopediaData) return null;
    return encyclopediaData.vrste.find(function (v) { return v.id === normalizeType(typeId); }) || null;
}

function findProblem(typeId, name) {
    var entry = speciesEntry(typeId);
    if (!entry || !name) return null;
    return [].concat(entry.bolesti || [], entry.stetnici || []).find(function (p) { return p.naziv === name; }) || null;
}

// Prepoznaj poznati problem iz enciklopedije u slobodnom tekstu (npr. "pepelnica na vrhovima")
function findProblemInText(typeId, text) {
    var entry = speciesEntry(typeId);
    if (!entry || !text) return null;
    var t = normalizeSearch(text);
    return [].concat(entry.bolesti || [], entry.stetnici || []).find(function (p) {
        var stem = normalizeSearch(p.naziv).split(/[^a-z]+/).filter(function (w) { return w.length >= 5; })[0];
        return stem && t.indexOf(stem.slice(0, 6)) !== -1;
    }) || null;
}

// ---------------------------------------------------------------------------
// Godišnji izvještaj + plan za sljedeću godinu
// ---------------------------------------------------------------------------
var reportModal = document.getElementById('report-modal');
var reportYear = new Date().getFullYear();
var reportWallet = null;
var reportMarkdown = '';

function itemLabel(item) {
    return (item.name || item.id) + ' (' + item.id + ')';
}

function suggestTaskForProblem(speciesId, problemName) {
    if (!tasksData) return null;
    var stem = normalizeSearch(problemName).split(/[^a-z]+/).filter(function (w) { return w.length >= 5; })[0];
    if (!stem) return null;
    stem = stem.slice(0, 6);
    return tasksData.zadaci.find(function (z) {
        return (z.vrste || []).indexOf(speciesId) !== -1 && normalizeSearch(z.naslov + ' ' + (z.opis || '')).indexOf(stem) !== -1;
    }) || null;
}

function monthsLabel(mjeseci) {
    return (mjeseci || []).map(function (m) { return MONTH_NAMES[m - 1].slice(0, 3).toLowerCase(); }).join('–');
}

function buildReport(year) {
    var y = String(year);
    var items = baseItems.concat(userItems);
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });

    // dnevnik
    var logs = [];
    Object.keys(plantLogs).forEach(function (id) {
        var item = byId[id];
        if (!item) return;
        (plantLogs[id] || []).forEach(function (e) {
            if (String(e.date).slice(0, 4) === y) logs.push({ item: item, e: e });
        });
    });
    var typeCounts = {};
    logs.forEach(function (l) { typeCounts[l.e.type] = (typeCounts[l.e.type] || 0) + 1; });

    // problemi
    var problems = {};
    logs.filter(function (l) { return l.e.type === 'bolest'; }).forEach(function (l) {
        var sp = normalizeType(l.item.treeType);
        var name = l.e.problem || l.e.text || 'Bez opisa';
        var key = sp + '|' + name;
        var p = problems[key] || (problems[key] = { species: sp, name: name, known: !!l.e.problem, trees: {}, dates: [] });
        p.trees[l.item.id] = l.item;
        p.dates.push(l.e.date);
    });
    var problemList = Object.keys(problems).map(function (k) { return problems[k]; })
        .sort(function (a, b) { return Object.keys(b.trees).length - Object.keys(a.trees).length; });

    // napomene
    var notes = logs.filter(function (l) { return (l.e.type === 'ostalo' || l.e.type === 'pregled') && l.e.text && !l.e.taskKey; });

    // rezidba: vrste koje imaju zadatak rezidbe, a stabla nemaju zapis orezivanja te godine
    var pruneSpecies = {};
    (tasksData ? tasksData.zadaci : []).forEach(function (z) {
        if (z.kategorija === 'orezivanje') (z.vrste || []).forEach(function (v) { pruneSpecies[v] = true; });
    });
    var notPruned = items.filter(function (i) {
        var sp = normalizeType(i.treeType);
        if (!pruneSpecies[sp] || sp === 'vinova_loza') return false;
        return !(plantLogs[i.id] || []).some(function (e) { return e.type === 'orezivanje' && String(e.date).slice(0, 4) === y; });
    });

    // berba
    var harvest = {};
    var harvestTrees = 0;
    Object.keys(plantHarvests).forEach(function (id) {
        var item = byId[id];
        var h = plantHarvests[id] && plantHarvests[id][y];
        if (!item || !h) return;
        var sp = normalizeType(item.treeType);
        var row = harvest[sp] || (harvest[sp] = { kg: 0, trees: 0, estMin: 0, estMax: 0 });
        row.kg += Number(h.kg || 0);
        row.trees++;
        harvestTrees++;
        if (sp !== 'ostalo') {
            var est = getYieldRangeKg(item);
            row.estMin += est.min;
            row.estMax += est.max;
        }
    });

    // raspored
    var taskStats = { done: 0, skipped: 0, postponed: 0 };
    Object.keys(taskDone).forEach(function (k) {
        if (k.slice(0, 4) !== y) return;
        var s = getTaskState(k);
        if (!s) return;
        if (s.status === 'done') taskStats.done++;
        else if (s.status === 'skipped') taskStats.skipped++;
        else if (s.status === 'postponed') taskStats.postponed++;
    });

    return { year: year, logs: logs, typeCounts: typeCounts, problems: problemList, notes: notes, notPruned: notPruned,
        harvest: harvest, harvestTrees: harvestTrees, taskStats: taskStats };
}

function renderReport() {
    if (!reportModal) return;
    var r = buildReport(reportYear);
    var md = [];
    var html = '';
    document.getElementById('report-year').textContent = String(reportYear);
    md.push('# Horvati voćnjak – izvještaj za ' + reportYear + '.', '');

    // sažetak
    var types = Object.keys(LOG_TYPES).filter(function (t) { return r.typeCounts[t]; });
    html += '<section class="rp-sec"><h3>📒 Radovi iz dnevnika</h3>';
    md.push('## Radovi iz dnevnika', '');
    if (!r.logs.length) {
        html += '<p class="pp-muted">Za ' + reportYear + '. nema zapisa u dnevniku.</p>';
        md.push('Nema zapisa u dnevniku.', '');
    } else {
        html += '<div class="rp-chips">' + types.map(function (t) {
            md.push('- ' + LOG_TYPES[t].naziv + ': ' + r.typeCounts[t]);
            return '<span class="pp-chip">' + LOG_TYPES[t].icon + ' ' + escapeHtml(LOG_TYPES[t].naziv) + ': <b>' + r.typeCounts[t] + '</b></span>';
        }).join('') + '</div>';
        md.push('');
    }
    var ts = r.taskStats;
    if (ts.done + ts.skipped + ts.postponed) {
        html += '<p>🗓️ Raspored: <b>' + ts.done + '</b> obavljeno, <b>' + ts.skipped + '</b> preskočeno, <b>' + ts.postponed + '</b> odgođeno.</p>';
        md.push('Raspored: ' + ts.done + ' obavljeno, ' + ts.skipped + ' preskočeno, ' + ts.postponed + ' odgođeno.', '');
    }
    html += '</section>';

    // bolesti
    html += '<section class="rp-sec"><h3>🦠 Bolesti i štetnici</h3>';
    md.push('## Bolesti i štetnici', '');
    if (!r.problems.length) {
        html += '<p class="pp-muted">Nije zabilježen nijedan problem.</p>';
        md.push('Nije zabilježen nijedan problem.', '');
    } else {
        html += '<ul class="rp-list">' + r.problems.map(function (p) {
            var trees = Object.keys(p.trees).map(function (id) { return p.trees[id]; });
            var dates = p.dates.slice().sort();
            var line = speciesName(p.species) + ' – ' + p.name + ': ' + trees.length + (trees.length === 1 ? ' stablo' : ' stabla') +
                ' (' + formatHrDate(dates[0]) + (dates.length > 1 ? ' – ' + formatHrDate(dates[dates.length - 1]) : '') + ')';
            md.push('- ' + line);
            return '<li>' + speciesIconHtml(p.species) + ' <b>' + escapeHtml(speciesName(p.species)) + '</b> – ' + escapeHtml(p.name) +
                ': ' + trees.length + (trees.length === 1 ? ' stablo' : ' stabla') + ' <small>(' + escapeHtml(trees.map(itemLabel).join(', ')) + '; ' +
                escapeHtml(formatHrDate(dates[0])) + (dates.length > 1 ? ' – ' + escapeHtml(formatHrDate(dates[dates.length - 1])) : '') + ')</small></li>';
        }).join('') + '</ul>';
        md.push('');
    }
    html += '</section>';

    // berba
    var hk = Object.keys(r.harvest);
    html += '<section class="rp-sec"><h3>🧺 Berba</h3>';
    md.push('## Berba', '');
    if (!hk.length) {
        html += '<p class="pp-muted">Berba za ' + reportYear + '. nije upisana.</p>';
        md.push('Berba nije upisana.', '');
    } else {
        html += '<table class="enc-table rp-table"><tbody>' + hk.sort(function (a, b) { return r.harvest[b].kg - r.harvest[a].kg; }).map(function (sp) {
            var h = r.harvest[sp];
            var est = h.estMax ? Math.round(h.estMin) + '–' + Math.round(h.estMax) + ' kg' : '–';
            md.push('- ' + speciesName(sp) + ': ' + (Math.round(h.kg * 10) / 10) + ' kg (' + h.trees + ' stabala, procjena ' + est + ')');
            return '<tr><th scope="row">' + speciesIconHtml(sp) + ' ' + escapeHtml(speciesName(sp)) + '</th><td><b>' + (Math.round(h.kg * 10) / 10) + ' kg</b> s ' + h.trees +
                (h.trees === 1 ? ' stabla' : ' stabala') + '</td><td>procjena za ta stabla: ' + est + '</td></tr>';
        }).join('') + '</tbody></table>';
        md.push('');
    }
    html += '</section>';

    // napomene
    if (r.notes.length) {
        html += '<section class="rp-sec"><h3>📝 Napomene i pregledi</h3><ul class="rp-list">' + r.notes.map(function (n) {
            md.push('- ' + formatHrDate(n.e.date) + ' ' + itemLabel(n.item) + ': ' + n.e.text);
            return '<li><small>' + escapeHtml(formatHrDate(n.e.date)) + '</small> <b>' + escapeHtml(itemLabel(n.item)) + '</b>: ' + escapeHtml(n.e.text) + '</li>';
        }).join('') + '</ul></section>';
        md.splice(md.length - r.notes.length, 0, '## Napomene i pregledi', '');
        md.push('');
    }

    // novčanik (samo admin)
    if (isAdminUser && reportWallet) {
        var w = reportWallet.filter(function (e) { return String(e.date).slice(0, 4) === String(reportYear) && !e.planned; });
        var cost = 0;
        var income = 0;
        w.forEach(function (e) { if (e.kind === 'prihod') income += e.amount; else cost += e.amount; });
        var bal = income - cost;
        html += '<section class="rp-sec"><h3>💰 Novčanik</h3><p>Troškovi <b>' + formatEur(cost) + '</b> · Prihodi <b>' + formatEur(income) + '</b> · ' +
            (bal >= 0 ? 'Dobit' : 'Gubitak') + ' <b class="' + (bal >= 0 ? 'rp-pos' : 'rp-neg') + '">' + (bal >= 0 ? '+' : '−') + formatEur(Math.abs(bal)) + '</b></p></section>';
        md.push('## Novčanik', '', 'Troškovi ' + formatEur(cost) + ', prihodi ' + formatEur(income) + ', ' + (bal >= 0 ? 'dobit +' : 'gubitak −') + formatEur(Math.abs(bal)), '');
    }

    // plan
    var next = reportYear + 1;
    html += '<section class="rp-sec rp-plan"><h3>📌 Plan za ' + next + '.</h3>';
    md.push('## Plan za ' + next + '.', '');
    var planCount = 0;
    if (r.problems.length) {
        html += '<ul class="rp-plan-list">' + r.problems.map(function (p, idx) {
            planCount++;
            var prob = p.known ? findProblem(p.species, p.name) : findProblemInText(p.species, p.name);
            var task = suggestTaskForProblem(p.species, prob ? prob.naziv : p.name);
            var title = speciesName(p.species) + ': ' + p.name + (prob && !p.known ? ' → ' + prob.naziv : '');
            var fix = prob && prob.rjesenje ? prob.rjesenje : 'Pratiti stanje i po potrebi provjeriti u enciklopediji ili sa savjetodavnom službom.';
            md.push('- [ ] ' + title + ' – ' + fix + (task ? ' (u rasporedu: ' + task.naslov + ', ' + monthsLabel(task.mjeseci) + ')' : ''));
            return '<li><div class="rp-plan-title">' + speciesIconHtml(p.species) + ' <b>' + escapeHtml(title) + '</b></div>' +
                '<div class="enc-problem-row"><span class="enc-tag fix">✅ Što napraviti</span><p>' + escapeHtml(fix) + '</p></div>' +
                (task
                    ? '<div class="rp-plan-task">🗓️ Već u rasporedu: <b>' + escapeHtml(task.naslov) + '</b> (' + escapeHtml(monthsLabel(task.mjeseci)) + ')</div>'
                    : (isAdminUser ? '<div class="rp-plan-task">Podsjetnik u ' + next + '.: <select class="rp-month" data-idx="' + idx + '">' +
                        MONTH_NAMES.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i === 1 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
                        '</select> <button type="button" class="pp-act" data-act="rp-add" data-idx="' + idx + '">📌 Dodaj u raspored</button></div>' : '')) +
                '</li>';
        }).join('') + '</ul>';
    }
    var pruneBySpecies = {};
    r.notPruned.forEach(function (i) { var sp = normalizeType(i.treeType); pruneBySpecies[sp] = (pruneBySpecies[sp] || 0) + 1; });
    var pk = Object.keys(pruneBySpecies);
    if (pk.length && r.logs.length) {
        planCount++;
        var pruneText = pk.map(function (sp) { return speciesName(sp) + ' ' + pruneBySpecies[sp]; }).join(', ');
        html += '<p>✂️ Rezidba nije zabilježena na: ' + escapeHtml(pruneText) + '. Provjeri jesu li orezana ili ih uvrsti u zimsku rezidbu.</p>';
        md.push('- [ ] Rezidba nije zabilježena na: ' + pruneText);
    }
    if (!planCount) {
        html += '<p class="pp-muted">Nema posebnih prijedloga – vodi dnevnik (bolesti, rezidba) tijekom godine pa će plan biti konkretniji.</p>';
        md.push('Nema posebnih prijedloga.');
    }
    html += '</section>';

    reportMarkdown = md.join('\n') + '\n';
    document.getElementById('report-body').innerHTML = html;
    reportModal._problems = r.problems;
}

function openReport() {
    if (!reportModal) return;
    setMenuOpen(false);
    reportYear = new Date().getFullYear();
    reportModal.classList.remove('hidden');
    document.getElementById('report-body').innerHTML = '<p class="pp-muted">Učitavanje…</p>';
    var jobs = [loadTasks().catch(function () {}), loadEncyclopedia().catch(function () {})];
    if (isAdminUser) {
        jobs.push(walletRequest('GET').then(function (d) { reportWallet = d.entries || []; }).catch(function () { reportWallet = null; }));
    }
    Promise.all(jobs).then(renderReport);
}

function closeReport() {
    if (reportModal) reportModal.classList.add('hidden');
}

if (reportModal) {
    document.getElementById('open-report').addEventListener('click', openReport);
    document.getElementById('close-report').addEventListener('click', closeReport);
    reportModal.addEventListener('click', function (event) { if (event.target === reportModal) closeReport(); });
    document.getElementById('report-prev').addEventListener('click', function () { reportYear--; renderReport(); });
    document.getElementById('report-next').addEventListener('click', function () { reportYear++; renderReport(); });
    document.getElementById('report-print').addEventListener('click', function () {
        document.body.classList.add('printing-report');
        window.print();
        setTimeout(function () { document.body.classList.remove('printing-report'); }, 500);
    });
    document.getElementById('report-download').addEventListener('click', function () {
        var blob = new Blob([reportMarkdown], { type: 'text/markdown;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vocnjak-izvjestaj-' + reportYear + '.md';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
    document.getElementById('report-csv').addEventListener('click', function () {
        var rows = [['Datum', 'Stablo', 'ID', 'Vrsta', 'Opis', 'Prepoznato kao']];
        Object.keys(plantLogs).forEach(function (id) {
            var item = allItemsById[id];
            if (!item) return;
            (plantLogs[id] || []).forEach(function (e) {
                if (e.type !== 'bolest' || String(e.date).slice(0, 4) !== String(reportYear)) return;
                var prob = e.problem ? findProblem(item.treeType, e.problem) : findProblemInText(item.treeType, e.text);
                rows.push([formatHrDate(e.date), item.name || '', item.id, speciesName(normalizeType(item.treeType)), e.problem || e.text || '', prob ? prob.naziv : '']);
            });
        });
        if (rows.length === 1) {
            alert('Za ' + reportYear + '. nema zapisa bolesti i štetnika.');
            return;
        }
        rows = [rows[0]].concat(rows.slice(1).sort(function (x, y) { return (x[1] + x[2]).localeCompare(y[1] + y[2], 'hr') || x[0].localeCompare(y[0]); }));
        var csv = '\uFEFF' + rows.map(function (row) {
            return row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(';');
        }).join('\r\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'vocnjak-bolesti-' + reportYear + '.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    });
    document.getElementById('report-body').addEventListener('click', function (event) {
        var btn = event.target.closest('[data-act="rp-add"]');
        if (!btn || !canEdit()) return;
        var p = (reportModal._problems || [])[Number(btn.getAttribute('data-idx'))];
        if (!p) return;
        var monthSel = document.querySelector('.rp-month[data-idx="' + btn.getAttribute('data-idx') + '"]');
        var prob = p.known ? findProblem(p.species, p.name) : findProblemInText(p.species, p.name);
        addCustomTask({
            naslov: 'Prevencija: ' + p.name + ' (' + speciesName(p.species) + ')',
            opis: prob && prob.rjesenje ? prob.rjesenje : 'Prošle godine zabilježeno: ' + p.name,
            mjeseci: [Number(monthSel ? monthSel.value : 2)],
            godina: reportYear + 1,
            prioritet: 2,
            kategorija: 'vlastito',
            vrste: p.species && p.species !== 'ostalo' ? [p.species] : [],
            at: new Date().toISOString()
        });
        btn.outerHTML = '<span class="pp-ok">✓ Dodano u raspored za ' + (reportYear + 1) + '.</span>';
    });
}

// ---------------------------------------------------------------------------
// Probni admin način (localStorage)
// ---------------------------------------------------------------------------
function demoMaps() {
    return {
        userItems: userItems,
        noteOverrides: noteOverrides,
        plantDetails: plantDetails,
        positionOverrides: positionOverrides,
        deletedIds: deletedIds,
        taskDone: taskDone,
        plantLogs: plantLogs,
        plantHarvests: plantHarvests,
        treeTaskStates: treeTaskStates,
        customTasks: customTasks,
        beds: beds
    };
}

var demoSaveTimer = null;
function scheduleDemoSave() {
    if (demoSaveTimer) clearTimeout(demoSaveTimer);
    demoSaveTimer = setTimeout(function () {
        demoSaveTimer = null;
        try {
            localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(demoMaps()));
            setSyncStatus('ok');
        } catch (e) {
            setSyncStatus('error', '⚠️ Probne promjene se ne mogu spremiti u preglednik.');
        }
    }, 150);
}

// Probno stanje (ako postoji) zamjenjuje izmjene sa servera; originalna stabla ostaju ista
function demoOverlay(state) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(DEMO_STATE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return state;
    var out = Object.assign({}, state);
    Object.keys(saved).forEach(function (k) { out[k] = saved[k]; });
    return out;
}

function showDemoUi() {
    document.body.classList.add('demo-mode');
    var banner = document.getElementById('demo-banner');
    if (banner) banner.classList.remove('hidden');
    var text = document.getElementById('login-status-text');
    if (text) text.innerHTML = '🧪 <b>Probni admin</b>';
    if (logoutBtn) logoutBtn.textContent = 'Izađi';
}

function startDemo() {
    askConfirm('Isprobati admin način?',
        'Dobit ćeš sve admin opcije (dodavanje i premještanje stabala, dnevnik, berba, raspored, novčanik…). ' +
        'Ništa se ne sprema na server – promjene ostaju samo u ovom pregledniku i nitko ih drugi ne vidi. Kreće se od stvarnog stanja.',
        '🧪 Isprobaj').then(function (ok) {
        if (!ok) return;
        try {
            localStorage.removeItem(DEMO_STATE_KEY);
            localStorage.removeItem(DEMO_WALLET_KEY);
            localStorage.setItem(DEMO_FLAG_KEY, '1');
        } catch (e) {
            alert('Preglednik ne dopušta spremanje (localStorage), pa probni način ne može raditi.');
            return;
        }
        window.location.reload();
    });
}

function clearDemoStorage() {
    try {
        localStorage.removeItem(DEMO_FLAG_KEY);
        localStorage.removeItem(DEMO_STATE_KEY);
        localStorage.removeItem(DEMO_WALLET_KEY);
    } catch (e) { /* ništa */ }
}

function exitDemo() {
    askConfirm('Izaći iz probnog načina?', 'Probne promjene će se obrisati, a stranica se vraća na stvarno stanje.', 'Izađi').then(function (ok) {
        if (!ok) return;
        clearDemoStorage();
        window.location.reload();
    });
}

function resetDemo() {
    askConfirm('Vratiti stvarno stanje?', 'Sve probne promjene se brišu, a probni način ostaje uključen i kreće ispočetka od stvarnog stanja.', '↺ Vrati').then(function (ok) {
        if (!ok) return;
        try {
            localStorage.removeItem(DEMO_STATE_KEY);
            localStorage.removeItem(DEMO_WALLET_KEY);
        } catch (e) { /* ništa */ }
        window.location.reload();
    });
}

function demoWalletRequest(method, body) {
    var list = [];
    try { list = JSON.parse(localStorage.getItem(DEMO_WALLET_KEY) || '[]'); } catch (e) { list = []; }
    var store = function () { localStorage.setItem(DEMO_WALLET_KEY, JSON.stringify(list)); };
    return new Promise(function (resolve) {
        if (method === 'GET') {
            resolve({ entries: list.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); }) });
            return;
        }
        if (body.action === 'delete') {
            list = list.filter(function (e) { return e.id !== body.id; });
            store();
            resolve({ deleted: body.id });
            return;
        }
        var e = Object.assign({}, body.entry, { amount: Math.round(Number(body.entry.amount) * 100) / 100, planned: body.entry.planned === true });
        list = list.filter(function (x) { return x.id !== e.id; }).concat([e]);
        store();
        resolve({ entry: e });
    });
}

var demoStartBtn = document.getElementById('demo-start');
if (demoStartBtn) demoStartBtn.addEventListener('click', startDemo);
var demoExitBtn = document.getElementById('demo-exit');
if (demoExitBtn) demoExitBtn.addEventListener('click', exitDemo);
var demoResetBtn = document.getElementById('demo-reset');
if (demoResetBtn) demoResetBtn.addEventListener('click', resetDemo);
window.addEventListener('pagehide', function () {
    if (demoMode && demoSaveTimer) {
        clearTimeout(demoSaveTimer);
        try { localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(demoMaps())); } catch (e) { /* ništa */ }
    }
});

// ---------------------------------------------------------------------------
// Gredice i povrće
// Mjerilo karte izračunato iz stvarnih GPS koordinata parcele (kml_source/Horvati_sluzbeno.kml):
// karta nije zarotirana, ali je rastegnuta – 1 jedinica istok–zapad = 0,0725 m, sjever–jug = 0,1039 m.
// ---------------------------------------------------------------------------
var METERS_PER_LNG = 0.072519;
var METERS_PER_LAT = 0.103927;
var VEG_FAMILY = {
    rajcica: 'pomoćnice', paprika: 'pomoćnice', patlidzan: 'pomoćnice', krumpir: 'pomoćnice',
    krastavac: 'tikvenjače', tikvica: 'tikvenjače', bundeva: 'tikvenjače', lubenica: 'tikvenjače',
    kupus: 'kupusnjače', rotkvica: 'kupusnjače',
    luk: 'lukovi', cesnjak: 'lukovi', poriluk: 'lukovi',
    mrkva: 'štitarke', persin: 'štitarke',
    grah: 'mahunarke', grasak: 'mahunarke',
    cikla: 'lobode', blitva: 'lobode', spinat: 'lobode',
    salata: 'glavočike', kukuruz: 'trave'
};
var beds = {}; // id -> { id, naziv, lat, lng, sirina, duzina, smjer: 'ns'|'ew', napomena, sadnje: [...] }
var bedLayers = {}; // id -> { rect, label }
var bedLayerGroup = L.layerGroup().addTo(map);
var selectedBedId = null;
var bedPlacement = null; // { mode: 'new'|'move', bed }
var bedPreview = null;

function bedSpan(bed) {
    var ew = bed.smjer === 'ew' ? bed.duzina : bed.sirina; // istok–zapad u metrima
    var ns = bed.smjer === 'ew' ? bed.sirina : bed.duzina; // sjever–jug u metrima
    return { lng: ew / METERS_PER_LNG, lat: ns / METERS_PER_LAT };
}

function bedBounds(bed, lat, lng) {
    var span = bedSpan(bed);
    var cLat = lat !== undefined ? lat : bed.lat;
    var cLng = lng !== undefined ? lng : bed.lng;
    return [[cLat - span.lat / 2, cLng - span.lng / 2], [cLat + span.lat / 2, cLng + span.lng / 2]];
}

function vegById(id) {
    return vegData ? vegData.vrste.find(function (v) { return v.id === id; }) : null;
}

function bedYearPlantings(bed, year) {
    return (bed.sadnje || []).filter(function (s) { return String(s.datum || '').slice(0, 4) === String(year); });
}

function fmtMeters(n) {
    return String(Math.round(Number(n) * 100) / 100).replace('.', ',');
}

// Kutovi gredice (zakrenute za bed.rotacija stupnjeva u smjeru kazaljke) – računa se u metrima,
// pa se pretvara u jedinice karte, tako da gredica i zakrenuta ostaje u stvarnim dimenzijama.
function bedCorners(bed, lat, lng) {
    var cLat = lat !== undefined ? lat : bed.lat;
    var cLng = lng !== undefined ? lng : bed.lng;
    var ew = (bed.smjer === 'ew' ? bed.duzina : bed.sirina) / 2;
    var ns = (bed.smjer === 'ew' ? bed.sirina : bed.duzina) / 2;
    var t = (Number(bed.rotacija) || 0) * Math.PI / 180;
    var cos = Math.cos(t);
    var sin = Math.sin(t);
    return [[-ew, ns], [ew, ns], [ew, -ns], [-ew, -ns]].map(function (p) {
        var x = p[0] * cos + p[1] * sin;
        var y = -p[0] * sin + p[1] * cos;
        return [cLat + y / METERS_PER_LAT, cLng + x / METERS_PER_LNG];
    });
}

// Ručka za okretanje: iznad gredice, u smjeru njezine "gornje" strane
function bedHandlePos(bed) {
    var ns = (bed.smjer === 'ew' ? bed.sirina : bed.duzina) / 2;
    var ew = (bed.smjer === 'ew' ? bed.duzina : bed.sirina) / 2;
    var d = ns + Math.max(0.8, Math.min(3, Math.max(ns, ew) * 0.4));
    var t = (Number(bed.rotacija) || 0) * Math.PI / 180;
    return [bed.lat + d * Math.cos(t) / METERS_PER_LAT, bed.lng + d * Math.sin(t) / METERS_PER_LNG];
}

function bedEmojis(bed) {
    var year = new Date().getFullYear();
    var emojis = [];
    bedYearPlantings(bed, year).forEach(function (s) {
        var v = vegById(s.povrce);
        var e = v ? v.emoji : '🌱';
        if (emojis.indexOf(e) === -1) emojis.push(e);
    });
    return emojis;
}

function removeBedLayers(id) {
    var old = bedLayers[id];
    if (!old) return;
    ['rect', 'label', 'handle', 'line'].forEach(function (k) { if (old[k]) bedLayerGroup.removeLayer(old[k]); });
    delete bedLayers[id];
}

function drawBed(bed) {
    removeBedLayers(bed.id);
    var selected = bed.id === selectedBedId;
    var rect = L.polygon(bedCorners(bed), {
        color: selected ? '#1e88e5' : '#4e2f12',
        weight: selected ? 3 : 1.5,
        fillColor: '#8b5a2b',
        fillOpacity: 0.55,
        bubblingMouseEvents: false
    });
    rect.on('click', function () { openBedPanel(bed.id); });
    rect.addTo(bedLayerGroup);
    var layers = { rect: rect };

    // emoji povrća unutar gredice (bez naziva)
    var emojis = bedEmojis(bed);
    if (emojis.length) {
        var label = L.marker([bed.lat, bed.lng], {
            icon: L.divIcon({ className: 'bed-label-wrap', html: '<div class="bed-emoji-inside">' + emojis.slice(0, 4).join('') + '</div>', iconSize: null }),
            zIndexOffset: -500,
            keyboard: false
        });
        label.on('click', function () { openBedPanel(bed.id); });
        label.addTo(bedLayerGroup);
        layers.label = label;
    }

    // ručka za okretanje (samo odabrana gredica, samo admin)
    if (selected && canEdit()) {
        var hp = bedHandlePos(bed);
        var line = L.polyline([[bed.lat, bed.lng], hp], { color: '#1e88e5', weight: 1.5, dashArray: '4 4', interactive: false }).addTo(bedLayerGroup);
        var handle = L.marker(hp, {
            draggable: true,
            icon: L.divIcon({ className: 'bed-handle-wrap', html: '<div class="bed-handle" title="Povuci za okretanje">⟳</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
            zIndexOffset: 2000,
            keyboard: false
        });
        handle.on('drag', function (e) {
            var p = e.target.getLatLng();
            var dx = (p.lng - bed.lng) * METERS_PER_LNG;
            var dy = (p.lat - bed.lat) * METERS_PER_LAT;
            var deg = Math.round(Math.atan2(dx, dy) * 180 / Math.PI);
            bed.rotacija = (deg + 360) % 360;
            rect.setLatLngs(bedCorners(bed));
            line.setLatLngs([[bed.lat, bed.lng], p]);
            var sizeEl = document.getElementById('bed-size');
            if (sizeEl && selectedBedId === bed.id) sizeEl.textContent = bedSizeText(bed);
        });
        handle.on('dragend', function () {
            saveBeds();
            drawBed(bed);
        });
        handle.addTo(bedLayerGroup);
        layers.handle = handle;
        layers.line = line;
    }
    bedLayers[bed.id] = layers;
}

function bedSizeText(bed) {
    var rot = Number(bed.rotacija) || 0;
    return fmtMeters(bed.sirina) + ' × ' + fmtMeters(bed.duzina) + ' m · ' + fmtMeters(bed.sirina * bed.duzina) + ' m² · dužina ' +
        (bed.smjer === 'ew' ? 'istok–zapad' : 'sjever–jug') + (rot ? ' · zakrenuto ' + rot + '°' : '');
}

function renderBeds() {
    bedLayerGroup.clearLayers();
    bedLayers = {};
    Object.keys(beds).forEach(function (id) { drawBed(beds[id]); });
}

function saveBeds() {
    if (storageMode === 'server') queueServerSync('bed', beds);
}

function nextBedName() {
    var n = Object.keys(beds).length + 1;
    var names = Object.keys(beds).map(function (id) { return beds[id].naziv; });
    while (names.indexOf('Gredica ' + n) !== -1) n++;
    return 'Gredica ' + n;
}

// ----- dodavanje i premještanje gredice ---------------------------------------
var addBedModal = document.getElementById('add-bed-modal');

function openAddBedModal() {
    if (!canEdit() || !addBedModal) return;
    setMenuOpen(false);
    setPlacementEnabled(false);
    setDragEnabled(false);
    document.getElementById('add-bed-form').reset();
    document.getElementById('bed-new-name').value = nextBedName();
    document.getElementById('add-bed-error').classList.add('hidden');
    addBedModal.classList.remove('hidden');
    document.getElementById('bed-new-width').focus();
}

function closeAddBedModal() {
    if (addBedModal) addBedModal.classList.add('hidden');
}

function startBedPlacement(mode, bed) {
    bedPlacement = { mode: mode, bed: bed };
    document.body.classList.add('placing-tree');
    var hint = document.getElementById('placement-hint');
    var hintText = document.getElementById('placement-hint-text');
    if (hintText) hintText.textContent = '🟫 ' + (mode === 'move' ? 'Klikni novo mjesto za: ' : 'Klikni na kartu gdje je: ') + bed.naziv +
        ' (' + fmtMeters(bed.sirina) + ' × ' + fmtMeters(bed.duzina) + ' m)';
    if (hint) hint.classList.remove('hidden');
    if (bedPreview) map.removeLayer(bedPreview);
    bedPreview = L.polygon(bedCorners(bed, -9999, -9999), { color: '#1e88e5', weight: 2, dashArray: '4 4', fillColor: '#8b5a2b', fillOpacity: 0.35, interactive: false }).addTo(map);
}

function stopBedPlacement() {
    if (!bedPlacement) return;
    bedPlacement = null;
    if (bedPreview) { map.removeLayer(bedPreview); bedPreview = null; }
    document.body.classList.remove('placing-tree');
    var hint = document.getElementById('placement-hint');
    if (hint && !placementEnabled) hint.classList.add('hidden');
}

map.on('mousemove', function (e) {
    if (!bedPlacement || !bedPreview) return;
    bedPreview.setLatLngs(bedCorners(bedPlacement.bed, e.latlng.lat, e.latlng.lng));
});

map.on('click', function (e) {
    if (bedPlacement) {
        var bed = bedPlacement.bed;
        bed.lat = e.latlng.lat;
        bed.lng = e.latlng.lng;
        beds[bed.id] = bed;
        stopBedPlacement();
        saveBeds();
        drawBed(bed);
        openBedPanel(bed.id);
        return;
    }
    if (selectedBedId) closeBedPanel();
});

if (addBedModal) {
    document.getElementById('open-add-bed').addEventListener('click', openAddBedModal);
    document.getElementById('close-add-bed').addEventListener('click', closeAddBedModal);
    document.getElementById('cancel-add-bed').addEventListener('click', closeAddBedModal);
    addBedModal.addEventListener('click', function (event) { if (event.target === addBedModal) closeAddBedModal(); });
    document.getElementById('add-bed-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var w = Number(String(document.getElementById('bed-new-width').value).replace(',', '.'));
        var l = Number(String(document.getElementById('bed-new-length').value).replace(',', '.'));
        var errEl = document.getElementById('add-bed-error');
        if (!(w > 0 && w <= 50) || !(l > 0 && l <= 100)) {
            errEl.textContent = 'Upiši širinu i dužinu u metrima (npr. 1 i 5).';
            errEl.classList.remove('hidden');
            return;
        }
        var bed = {
            id: 'bed-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            naziv: document.getElementById('bed-new-name').value.trim() || nextBedName(),
            sirina: w,
            duzina: l,
            smjer: document.getElementById('bed-new-dir').value,
            napomena: '',
            sadnje: [],
            at: new Date().toISOString()
        };
        closeAddBedModal();
        startBedPlacement('new', bed);
    });
}

// ----- panel gredice ----------------------------------------------------------
var bedFormEl = document.getElementById('bed-form');

function openBedPanel(id) {
    var bed = beds[id];
    if (!bed || !bedFormEl) return;
    if (selectedPlant) closePlantPanelSelection();
    var prev = selectedBedId;
    selectedBedId = id;
    if (prev && beds[prev]) drawBed(beds[prev]);
    drawBed(bed);
    if (plantPanelEl && plantPanelEl.classList.contains('minimized')) togglePlantPanelBtn.click();
    document.getElementById('plant-empty').classList.add('hidden');
    document.getElementById('plant-form').classList.add('hidden');
    bedFormEl.classList.remove('hidden');
    var dateEl = document.getElementById('bed-date');
    if (dateEl && !dateEl.value) dateEl.value = todayIso();
    loadVegetables().then(function () { renderBedPanel(); }).catch(function () { renderBedPanel(); });
}

function closeBedPanel() {
    var prev = selectedBedId;
    selectedBedId = null;
    if (prev && beds[prev]) drawBed(beds[prev]);
    if (bedFormEl) bedFormEl.classList.add('hidden');
    if (!selectedPlant) document.getElementById('plant-empty').classList.remove('hidden');
}

function plantingText(s) {
    var v = vegById(s.povrce);
    var amount = s.kolicina === 'redovi' && s.iznos ? s.iznos + (Number(s.iznos) === 1 ? ' red' : (Number(s.iznos) < 5 ? ' reda' : ' redova'))
        : s.kolicina === 'dio' && s.iznos ? fmtMeters(s.iznos) + ' m gredice'
        : 'cijela gredica';
    return { emoji: v ? v.emoji : '🌱', naziv: v ? v.naziv : s.povrce, amount: amount };
}

function rotationWarning(bed, vegId, year) {
    var fam = VEG_FAMILY[vegId];
    if (!fam) return '';
    var hits = (bed.sadnje || []).filter(function (s) {
        var y = Number(String(s.datum || '').slice(0, 4));
        return VEG_FAMILY[s.povrce] === fam && y < year && y >= year - 3;
    });
    if (!hits.length) return '';
    var h = hits.sort(function (a, b) { return String(b.datum).localeCompare(String(a.datum)); })[0];
    var v = vegById(h.povrce);
    return '⚠️ Plodored: ' + (v ? v.naziv : h.povrce) + ' je ovdje bio ' + String(h.datum).slice(0, 4) + '. – ista porodica (' + fam +
        '). Preporuka je 3–4 godine razmaka.';
}

function updateBedVegInfo() {
    var bed = beds[selectedBedId];
    var sel = document.getElementById('bed-veg');
    var info = document.getElementById('bed-veg-info');
    var warn = document.getElementById('bed-warning');
    if (!bed || !sel || !info) return;
    var v = vegById(sel.value);
    var month = function (arr) { return (arr || []).length ? arr.map(function (m) { return MONTH_NAMES[m - 1].slice(0, 3).toLowerCase(); }).join(', ') : '–'; };
    info.innerHTML = v ? (v.unutra && v.unutra.length ? '🟦 Presadnice: ' + month(v.unutra) + ' · ' : '') + '🟩 Sadnja: ' + month(v.sadnja) + ' · 🟨 Berba: ' + month(v.berba) : '';
    var year = Number(String(document.getElementById('bed-date').value || todayIso()).slice(0, 4));
    var w = rotationWarning(bed, sel.value, year);
    warn.textContent = w;
    warn.classList.toggle('hidden', !w);
    var amountKind = document.getElementById('bed-amount-kind').value;
    document.getElementById('bed-amount').classList.toggle('hidden', amountKind === 'cijela');
}

function renderBedPanel() {
    var bed = beds[selectedBedId];
    if (!bed) return;
    var editable = canEdit();
    document.getElementById('bed-name').textContent = bed.naziv;
    var area = bed.sirina * bed.duzina;
    document.getElementById('bed-size').textContent = bedSizeText(bed);
    var year = new Date().getFullYear();
    document.getElementById('bed-year').textContent = String(year);

    var current = bedYearPlantings(bed, year).sort(function (a, b) { return String(a.datum).localeCompare(String(b.datum)); });
    var ul = document.getElementById('bed-plantings');
    ul.innerHTML = current.length ? current.map(function (s) {
        var t = plantingText(s);
        return '<li><span class="pp-log-icon">' + t.emoji + '</span><div class="pp-log-main"><div><b>' + escapeHtml(t.naziv) + '</b> <small>' +
            escapeHtml(t.amount) + ' · ' + escapeHtml(formatHrDate(s.datum)) + '</small></div>' +
            (s.napomena ? '<div class="pp-log-text">' + escapeHtml(s.napomena) + '</div>' : '') + '</div>' +
            (editable ? '<button type="button" class="pp-x" data-act="bed-plant-del" data-id="' + escapeHtml(s.id) + '" title="Obriši">✕</button>' : '') + '</li>';
    }).join('') : '<li class="pp-muted">Ove godine još ništa nije posađeno.</li>';

    var older = (bed.sadnje || []).filter(function (s) { return String(s.datum || '').slice(0, 4) < String(year); });
    var byYear = {};
    older.forEach(function (s) { (byYear[String(s.datum).slice(0, 4)] = byYear[String(s.datum).slice(0, 4)] || []).push(s); });
    var years = Object.keys(byYear).sort().reverse();
    document.getElementById('bed-history').innerHTML = years.length ? years.map(function (y) {
        return '<li><b class="pp-year">' + y + '</b><span>' + byYear[y].map(function (s) {
            var t = plantingText(s);
            return t.emoji + ' ' + escapeHtml(t.naziv) + ' <small>(' + escapeHtml(t.amount) + ')</small>';
        }).join(', ') + '</span></li>';
    }).join('') : '<li class="pp-muted">Nema zapisa iz prijašnjih godina.</li>';

    var sel = document.getElementById('bed-veg');
    if (sel && vegData && sel.options.length < 2) {
        sel.innerHTML = sortByName(vegData.vrste).map(function (v) {
            return '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.emoji + ' ' + v.naziv) + '</option>';
        }).join('');
    }
    updateBedVegInfo();
}

if (bedFormEl) {
    ['bed-veg', 'bed-date', 'bed-amount-kind'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', updateBedVegInfo);
    });
    document.getElementById('bed-plant-form').addEventListener('submit', function (event) {
        event.preventDefault();
        var bed = beds[selectedBedId];
        if (!bed || !canEdit()) return;
        var kind = document.getElementById('bed-amount-kind').value;
        var amount = Number(String(document.getElementById('bed-amount').value).replace(',', '.'));
        if (kind !== 'cijela' && !(amount > 0)) {
            alert(kind === 'redovi' ? 'Upiši broj redova.' : 'Upiši koliko metara gredice.');
            return;
        }
        bed.sadnje = (bed.sadnje || []).concat([{
            id: 's-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            povrce: document.getElementById('bed-veg').value,
            datum: document.getElementById('bed-date').value || todayIso(),
            kolicina: kind,
            iznos: kind === 'cijela' ? null : amount,
            napomena: document.getElementById('bed-note').value.trim()
        }]);
        document.getElementById('bed-note').value = '';
        document.getElementById('bed-amount').value = '';
        saveBeds();
        drawBed(bed);
        renderBedPanel();
    });
    bedFormEl.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-act]');
        if (!btn) return;
        var bed = beds[selectedBedId];
        if (!bed || !canEdit()) return;
        var act = btn.getAttribute('data-act');
        if (act === 'bed-plant-del') {
            var sid = btn.getAttribute('data-id');
            askConfirm('Obrisati sadnju?', 'Zapis će biti uklonjen iz gredice.', 'Obriši').then(function (ok) {
                if (!ok) return;
                bed.sadnje = (bed.sadnje || []).filter(function (s) { return s.id !== sid; });
                saveBeds();
                drawBed(bed);
                renderBedPanel();
            });
        } else if (act === 'bed-rotate-reset') {
            bed.rotacija = 0;
            saveBeds();
            drawBed(bed);
            renderBedPanel();
        } else if (act === 'bed-move') {
            startBedPlacement('move', bed);
        } else if (act === 'bed-delete') {
            askConfirm('Izbrisati gredicu?', 'Izbrisati "' + bed.naziv + '" zajedno s povijesti sadnje?', '🗑️ Izbriši').then(function (ok) {
                if (!ok) return;
                removeBedLayers(bed.id);
                delete beds[bed.id];
                saveBeds();
                closeBedPanel();
            });
        }
    });
}

document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    stopBedPlacement();
    closeAddBedModal();
});
