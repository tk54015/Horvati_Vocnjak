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

var baseItems = [];
var userItems = [];
var noteOverrides = {};
var userMarkersById = {};
var allItemsById = {};
var dragEnabled = false;

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
    if (t === 'kruska') return 'icons/pear.png';
    if (t === 'breskva') return 'icons/peach.png';
    if (t === 'kupina') return 'icons/blackberry.png';
    if (t === 'smokva') return 'icons/fig.png';
    if (t === 'sljiva') return 'icons/plum.png';
    if (t === 'tresnja') return 'icons/cherry.png';
    if (t === 'dunja') return 'icons/dunja.png';
    if (t === 'glog') return 'icons/glog.png';
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

function formatPopup(item) {
    var noteHtml = item.notes ? '<br>Napomena: ' + item.notes : '';
    return '<b>' + item.name + '</b><br>' + item.treeType + '<br>Lat: ' + Number(item.lat).toFixed(2) + ', Lng: ' + Number(item.lng).toFixed(2) + noteHtml + '<br><small>Klik na marker za napomenu</small>';
}

function saveUserItems() {
    try {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(userItems));
    } catch (error) {
        console.error('Ne mogu spremiti userItems:', error);
    }
}

function loadUserItems() {
    try {
        var raw = localStorage.getItem(USER_STORAGE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
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
    var merged = baseItems.concat(userItems);
    var payload = {
        meta: {
            naziv: 'Horvati vocnjak',
            verzija: 1,
            opis: 'Izvoz oznaka iz aplikacije',
            generatedAt: new Date().toISOString()
        },
        items: merged.map(toExportItem)
    };

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
    list.innerHTML = '';

    userItems.forEach(function (item) {
        var li = document.createElement('li');
        li.setAttribute('data-user-id', item.id);
        li.setAttribute('data-item-id', item.id);

        var notePart = item.notes ? ' | napomena: ' + item.notes : '';
        li.innerHTML = '<span><b>' + item.name + '</b> [' + item.treeType + '] - ' +
            Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2) + notePart + '</span>';

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-tree';
        removeBtn.setAttribute('data-user-id', item.id);
        removeBtn.title = 'Ukloni unos';
        removeBtn.textContent = 'x';
        li.appendChild(removeBtn);
        list.appendChild(li);
    });

    Object.keys(noteOverrides).forEach(function (itemId) {
        var note = noteOverrides[itemId];
        if (!note) return;
        var item = allItemsById[itemId];
        if (!item) return;

        var li = document.createElement('li');
        li.setAttribute('data-item-id', itemId);
        li.innerHTML = '<span><b>' + item.name + '</b> [' + item.treeType + '] - napomena: ' + note + '</span>';
        list.appendChild(li);
    });
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

function createMarker(item, options) {
    var opts = options || {};
    var markerOptions = {};

    var resolvedIcon = item.iconUrl || iconByType(item.treeType);
    if (resolvedIcon) {
        markerOptions.icon = L.icon({
            iconUrl: resolvedIcon,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        });
    }

    if (opts.isUserItem) {
        markerOptions.draggable = dragEnabled;
    }

    var marker = L.marker([item.lat, item.lng], markerOptions).addTo(map);
    marker.bindPopup(formatPopup(item));

    marker.on('click', function () {
        var current = item.notes || '';
        var newNote = prompt('Napomena za: ' + item.name, current);
        if (newNote === null) return;

        var cleaned = newNote.trim();
        applyNote(item, cleaned, !!opts.isUserItem);
        marker.setPopupContent(formatPopup(item));
        marker.openPopup();
    });

    if (opts.isUserItem && item.id) {
        userMarkersById[item.id] = marker;

        marker.on('dragend', function () {
            var newLatLng = marker.getLatLng();
            item.lat = newLatLng.lat;
            item.lng = newLatLng.lng;

            var found = userItems.find(function (i) { return i.id === item.id; });
            if (found) {
                found.lat = newLatLng.lat;
                found.lng = newLatLng.lng;
            }

            saveUserItems();
            marker.setPopupContent(formatPopup(item));
            renderChangeList();
        });
    }

    return marker;
}

function removeUserItem(userId) {
    var marker = userMarkersById[userId];
    if (marker) {
        map.removeLayer(marker);
        delete userMarkersById[userId];
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

function applyStoredNotesToBaseItems() {
    baseItems.forEach(function (item) {
        if (noteOverrides[item.id]) {
            item.notes = noteOverrides[item.id];
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

    fetch('data/stabla.json')
        .then(function (response) {
            if (!response.ok) throw new Error('Nema data/stabla.json');
            return response.json();
        })
        .then(function (data) {
            baseItems = normalizeItems(data);
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

document.addEventListener('keydown', function (e) {
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
        Object.keys(userMarkersById).forEach(function (id) {
            var marker = userMarkersById[id];
            if (!marker.dragging) return;
            if (dragEnabled) marker.dragging.enable();
            else marker.dragging.disable();
        });

        toggleDragBtn.textContent = dragEnabled ? '✏️ Uređivanje uključeno' : '🔒 Markeri zaključani';
        toggleDragBtn.classList.toggle('drag-active', dragEnabled);
        toggleDragBtn.classList.toggle('drag-locked', !dragEnabled);
    });
}

var treeListEl = document.getElementById('tree-list-items');
if (treeListEl) {
    treeListEl.addEventListener('click', function (event) {
        if (event.target.classList.contains('remove-tree')) {
            event.preventDefault();
            event.stopPropagation();

            var userId = event.target.getAttribute('data-user-id');
            if (!userId) return;
            removeUserItem(userId);
            return;
        }

        var row = event.target.closest('li[data-item-id]');
        if (!row) return;
        var itemId = row.getAttribute('data-item-id');
        if (!itemId) return;
        editNoteFromListItem(itemId);
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

    var marker = createMarker(newItem, { isUserItem: true });
    marker.openPopup();
    renderChangeList();
});