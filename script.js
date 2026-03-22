// Inicijalizacija mape
var map = L.map('map', {
    crs: L.CRS.Simple,
    minZoom: -4,
    maxZoom: 20,
    scrollWheelZoom: false,
    dragging: true,
    zoomControl: false
});

// custom wheel zoom around cursor
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

// Dodaj image overlay - zamijeni s vlastitom slikom
var imageUrl = 'garden.svg'; // Putanja do tvoje slike vrta
var imageBounds = [[0, 0], [714, 1000]]; // Prilagodi granicama slike
L.imageOverlay(imageUrl, imageBounds).addTo(map);
map.fitBounds(imageBounds);
map.setZoom(0); // lagano zoom out da se sve vidi, ali ne previše
map.setView([357, 500], 0);

var STORAGE_KEY = 'horvati_inventory_user_items_v1';
var baseItems = [];
var userItems = [];
var userMarkersById = {};

function addTreeToList(item, removable) {
    var list = document.getElementById('tree-list-items');
    if (!list) return;

    var li = document.createElement('li');
    var name = item.name || item.treeType;
    var treeType = item.treeType || 'Stablo';
    li.innerHTML = '<span><b>' + name + '</b> [' + treeType + '] - ' +
        Number(item.lat).toFixed(2) + ', ' + Number(item.lng).toFixed(2) + '</span>';

    if (removable && item.id) {
        li.setAttribute('data-user-id', item.id);
        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-tree';
        removeBtn.setAttribute('data-user-id', item.id);
        removeBtn.title = 'Ukloni unos';
        removeBtn.textContent = 'x';
        li.appendChild(removeBtn);
    }

    list.appendChild(li);
}

function saveUserItems() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(userItems));
    } catch (error) {
        console.error('Ne mogu spremiti u localStorage:', error);
    }
}

function loadUserItems() {
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Ne mogu učitati localStorage podatke:', error);
        return [];
    }
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '')
        .replace(/^_+|_+$/g, '') || 'oznaka';
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

function updateListItemCoords(userId, lat, lng) {
    var li = document.querySelector('#tree-list-items li[data-user-id="' + userId + '"]');
    if (!li) return;
    var span = li.querySelector('span');
    if (!span) return;
    var parts = span.innerHTML.split('] - ');
    if (parts.length >= 2) {
        span.innerHTML = parts[0] + '] - ' + Number(lat).toFixed(2) + ', ' + Number(lng).toFixed(2);
    }
}

function createMarker(item, options) {
    var opts = options || {};
    var markerOptions = {};
    if (item.iconUrl) {
        markerOptions.icon = L.icon({
            iconUrl: item.iconUrl,
            iconSize: [40, 40],
            iconAnchor: [20, 40],
            popupAnchor: [0, -40]
        });
    }

    if (opts.removable) {
        markerOptions.draggable = false;
    }

    var marker = L.marker([item.lat, item.lng], markerOptions).addTo(map);
    marker.bindPopup('<b>' + item.name + '</b><br>' + item.treeType + '<br>Lat: ' + Number(item.lat).toFixed(2) + ', Lng: ' + Number(item.lng).toFixed(2));
    addTreeToList(item, !!opts.removable);

    if (opts.removable && item.id) {
        userMarkersById[item.id] = marker;

        marker.on('dragend', function () {
            var newLatLng = marker.getLatLng();
            var found = userItems.find(function (i) { return i.id === item.id; });
            if (found) {
                found.lat = newLatLng.lat;
                found.lng = newLatLng.lng;
                saveUserItems();
            }
            marker.setPopupContent('<b>' + item.name + '</b><br>' + item.treeType + '<br>Lat: ' + Number(newLatLng.lat).toFixed(2) + ', Lng: ' + Number(newLatLng.lng).toFixed(2));
            updateListItemCoords(item.id, newLatLng.lat, newLatLng.lng);
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
    saveUserItems();

    var listItem = document.querySelector('#tree-list-items li[data-user-id="' + userId + '"]');
    if (listItem) {
        listItem.remove();
    }
}

function normalizeItems(data) {
    if (data && Array.isArray(data.items)) {
        return data.items.map(function (item) {
            return {
                id: item.id || null,
                name: item.naziv || item.id || 'Bez naziva',
                treeType: item.vrsta || item.kategorija || 'Stablo',
                lat: item.lat,
                lng: item.lng,
                notes: item.napomena || '',
                iconUrl: item.ikonica || null
            };
        });
    }

    if (data && Array.isArray(data.trees)) {
        return data.trees.map(function (tree) {
            return {
                id: null,
                name: tree.name || 'Bez naziva',
                treeType: 'stablo',
                lat: tree.lat,
                lng: tree.lng,
                notes: tree.notes || '',
                iconUrl: tree.image || null
            };
        });
    }

    return [];
}

function loadInventory() {
    fetch('data/stabla.json')
        .then(function (response) {
            if (!response.ok) throw new Error('Nema data/stabla.json');
            return response.json();
        })
        .then(function (data) {
            baseItems = normalizeItems(data);
            baseItems.forEach(function (item) { createMarker(item, { removable: false }); });
            userItems = loadUserItems();
            userItems.forEach(function (item) {
                if (!item.id) {
                    item.id = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
                }
                createMarker(item, { removable: true });
            });
            saveUserItems();
        })
        .catch(function () {
            fetch('data/trees.json')
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    baseItems = normalizeItems(data);
                    baseItems.forEach(function (item) { createMarker(item, { removable: false }); });
                    userItems = loadUserItems();
                    userItems.forEach(function (item) {
                        if (!item.id) {
                            item.id = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
                        }
                        createMarker(item, { removable: true });
                    });
                    saveUserItems();
                })
                .catch(function (error) {
                    console.error('Greška pri učitavanju podataka:', error);
                    userItems = loadUserItems();
                    userItems.forEach(function (item) {
                        if (!item.id) {
                            item.id = 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
                        }
                        createMarker(item, { removable: true });
                    });
                    saveUserItems();
                });
        });
}

loadInventory();

// Kompletne kontrole
// Rotacija maknuta, ostaje samo zoom

document.getElementById('zoom-in').addEventListener('click', function () { map.zoomIn(); });
document.getElementById('zoom-out').addEventListener('click', function () { map.zoomOut(); });

// Tipkovni prečaci
document.addEventListener('keydown', function(e) {
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

// Icon picker
var selectedIcon = 'icons/apple.png';
document.querySelectorAll('.icon-option').forEach(function(img) {
    if (img.dataset.icon === selectedIcon) img.classList.add('selected');
    img.addEventListener('click', function() {
        document.querySelectorAll('.icon-option').forEach(function(i) { i.classList.remove('selected'); });
        img.classList.add('selected');
        selectedIcon = img.dataset.icon;
    });
});

var exportBtn = document.getElementById('export-json');
if (exportBtn) {
    exportBtn.addEventListener('click', downloadJson);
}

var dragEnabled = false;

var toggleDragBtn = document.getElementById('toggle-drag');
if (toggleDragBtn) {
    toggleDragBtn.addEventListener('click', function () {
        dragEnabled = !dragEnabled;
        Object.keys(userMarkersById).forEach(function (id) {
            var m = userMarkersById[id];
            if (dragEnabled) {
                m.dragging.enable();
            } else {
                m.dragging.disable();
            }
        });
        toggleDragBtn.textContent = dragEnabled ? '✏️ Uređivanje uključeno' : '🔒 Markeri zaključani';
        toggleDragBtn.classList.toggle('drag-active', dragEnabled);
        toggleDragBtn.classList.toggle('drag-locked', !dragEnabled);
    });
}

var treeListEl = document.getElementById('tree-list-items');
if (treeListEl) {
    treeListEl.addEventListener('click', function (event) {
        if (!event.target.classList.contains('remove-tree')) return;
        event.preventDefault();
        event.stopPropagation();

        var userId = event.target.getAttribute('data-user-id');
        if (!userId) return;
        removeUserItem(userId);
    });
}

// On map click, prikaži koordinate i dodaj marker
map.on('click', function(e) {
    var coords = e.latlng;

    var treeTypeEl = document.getElementById('tree-type');
    var treeType = treeTypeEl ? treeTypeEl.options[treeTypeEl.selectedIndex].text : 'Stablo';

    var name = prompt('Ime/oznaka stabla? (vrsta: ' + treeType + ')');
    if (name === null) return;

    var newItem = {
        id: 'user_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        name: (name || treeType),
        treeType: treeType,
        lat: coords.lat,
        lng: coords.lng,
        notes: '',
        iconUrl: null
    };

    userItems.push(newItem);
    saveUserItems();
    var marker = createMarker(newItem, { removable: true });
    marker.openPopup();
});