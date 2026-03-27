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
var selectedPlant = null;

var VINE_DISPLAY_STEP = 5;
var FULL_ICON_SIZE = 30;
var VINE_DOT_SIZE = 4;
var VINE_DOT_HIT_MULTIPLIER = 4;

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '') || 'oznaka';
}

function normalizeType(typeText) {
    var t = String(typeText || '').toLowerCase();
    if (t.indexOf('jabuk') !== -1) return 'jabuka';
    if (t.indexOf('ribiz') !== -1) return 'ribizl';
    if (t.indexOf('kru') !== -1) return 'kruska';
    if (t.indexOf('bresk') !== -1) return 'breskva';
    if (t.indexOf('smok') !== -1) return 'smokva';
    if (t.indexOf('kupin') !== -1) return 'kupina';
    if (t.indexOf('glog') !== -1) return 'glog';
    if (t.indexOf('dunj') !== -1) return 'dunja';
    if (t.indexOf('plum') !== -1) return 'sljiva';
    if (t.indexOf('cherry') !== -1) return 'tresnja';
    if (t.indexOf('tres') !== -1 || t.indexOf('tre') !== -1) return 'tresnja';
    if (t.indexOf('sljiv') !== -1 || t.indexOf('slji') !== -1) return 'sljiva';
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
    if (t === 'dunja') return 'icons/dunja.png';
    if (t === 'glog') return 'icons/glog.png';
    if (t === 'vinova_loza') return 'icons/grapes.png';
    return null;
}

function nextGlobalIdNumber() {
    var maxNumber = 0;
    var all = baseItems.concat(userItems);
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

    var resolvedIcon = item.iconUrl || iconByType(item.treeType);
    if (!resolvedIcon) return null;

    var iconSize = FULL_ICON_SIZE;
    return L.icon({
        iconUrl: resolvedIcon,
        iconSize: [iconSize, iconSize],
        iconAnchor: [Math.round(iconSize / 2), iconSize],
        popupAnchor: [0, -iconSize]
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
        var raw = localStorage.getItem(USER_STORAGE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
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

            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(normalized));
        }

        return normalized;
    } catch (error) {
        console.error('Ne mogu učitati userItems:', error);
        return [];
    }
}

function saveNoteOverrides() {
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

    return {
        id: item.id || (baseId + '_' + (index + 1)),
        kategorija: category,
        vrsta: treeType,
        naziv: item.name || baseId,
        lat: Number(item.lat),
        lng: Number(item.lng),
        napomena: item.notes || '',
        ikonica: item.iconUrl || null
    };
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
        var emptyEl = document.getElementById('plant-empty');
        var formEl = document.getElementById('plant-form');
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (formEl) formEl.classList.add('hidden');
    }

    renderChangeList();
}

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

    var emptyEl = document.getElementById('plant-empty');
    var formEl = document.getElementById('plant-form');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (formEl) formEl.classList.remove('hidden');

    document.getElementById('plant-id').textContent = item.id || '-';
    document.getElementById('plant-type').textContent = item.treeType || '-';
    document.getElementById('plant-coords').textContent = Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2);

    var details = getPlantDetails(item.id);
    document.getElementById('status-orezano').value = details.orezano || 'nepoznato';
    document.getElementById('status-gnojeno').value = details.gnojeno || 'nepoznato';
    document.getElementById('status-spricano').value = details.spricano || '';

    var noteInput = document.getElementById('status-napomena');
    noteInput.value = details.napomena || item.notes || '';
    noteInput.setAttribute('readonly', 'readonly');
}

function saveSelectedPlantPanel() {
    if (!selectedPlant) return;
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
    noteOverrides = loadNoteOverrides();
    plantDetails = loadPlantDetails();
    positionOverrides = loadPositionOverrides();

    fetch('data/stabla.json')
        .then(function (response) {
            if (!response.ok) throw new Error('Nema data/stabla.json');
            return response.json();
        })
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

document.getElementById('zoom-in').addEventListener('click', function () { map.zoomIn(); });
document.getElementById('zoom-out').addEventListener('click', function () { map.zoomOut(); });

var noteInputEl = document.getElementById('status-napomena');
if (noteInputEl) {
    noteInputEl.addEventListener('focus', function () {
        noteInputEl.removeAttribute('readonly');
    });
    noteInputEl.addEventListener('click', function () {
        noteInputEl.removeAttribute('readonly');
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

var changeListEl = document.getElementById('tree-list-items');
if (changeListEl) {
    changeListEl.addEventListener('click', function (event) {
        var target = event.target;
        if (!target || !target.classList) return;
        var id = target.getAttribute('data-id');
        if (!id) return;

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
        return;
    }

    if (e.key === '+' || e.key === '=' || e.code === 'Equal') {
        map.zoomIn();
    } else if (e.key === '-' || e.key === '_' || e.code === 'Minus') {
        map.zoomOut();
    } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        map.panBy([-20, 0]);
        e.preventDefault();
    } else if (e.key === 'ArrowRight' || e.key === 'd') {
        map.panBy([20, 0]);
        e.preventDefault();
    } else if (e.key === 'ArrowUp' || e.key === 'w') {
        map.panBy([0, -20]);
        e.preventDefault();
    } else if (e.key === 'ArrowDown' || e.key === 's') {
        map.panBy([0, 20]);
        e.preventDefault();
    }
});

var exportBtn = document.getElementById('export-json');
if (exportBtn) {
    exportBtn.addEventListener('click', downloadJson);
}

var toggleDragBtn = document.getElementById('toggle-drag');
if (toggleDragBtn) {
    toggleDragBtn.addEventListener('click', function () {
        dragEnabled = !dragEnabled;
        Object.keys(allMarkersById).forEach(function (id) {
            var marker = allMarkersById[id];
            if (!marker.dragging) return;
            if (dragEnabled) marker.dragging.enable();
            else marker.dragging.disable();
        });

        toggleDragBtn.textContent = dragEnabled ? '✏️ Uređivanje uključeno' : '🔒 Markeri zaključani';
        toggleDragBtn.classList.toggle('drag-active', dragEnabled);
        toggleDragBtn.classList.toggle('drag-locked', !dragEnabled);
    });
}

// Klik na mapu: dodaj novo stablo
map.on('click', function (e) {
    var coords = e.latlng;
    var treeTypeEl = document.getElementById('tree-type');
    var treeTypeRaw = treeTypeEl ? treeTypeEl.options[treeTypeEl.selectedIndex].text : 'Stablo';
    var treeType = normalizeType(treeTypeRaw);
    var nextId = nextGlobalIdNumber();

    var name = prompt('Ime/oznaka stabla? (vrsta: ' + treeType + ')', treeType);
    if (name === null) return;

    var newItem = {
        id: treeType + String(nextId).padStart(3, '0'),
        name: (name || treeType),
        treeType: treeType,
        lat: coords.lat,
        lng: coords.lng,
        notes: '',
        iconUrl: iconByType(treeType)
    };

    userItems.push(newItem);
    allItemsById[newItem.id] = newItem;
    saveUserItems();

    createMarker(newItem, { isUserItem: true });
    renderChangeList();
});