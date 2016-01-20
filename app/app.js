(function() {
    var map = L.map('map', {
        crs: L.CRS.Simple,
        center: [0, 0],
    });
    var imageUrl = 'trumpington.png', imageBounds = [[-1, -1, 1, 1]];
    L.imageOverlay(imageUrl, imageBounds).addTo(map);
    map.fitBounds([[-1, -1, 1, 1]]);
})();
