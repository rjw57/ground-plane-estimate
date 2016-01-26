(function() {

// Entry point to application. Called after all functions and variables below
// have been initialised.
function main() {
    var imgUrl = 'trumpington.png';

    ffUi = new FloorFindUI('image-ui');
    ffUi.loadImage(imgUrl);

    fpUi = new FloorPreviewUI('floor-preview', ffUi);
    fpUi.loadImage(imgUrl);

    window.addEventListener('resize', function() {
        ffUi.containerResized();
        fpUi.containerResized();
    });

    var actions = {
        download: function() {
            // makes use of saveAs function from FileSaver.min.js.
            var columnMajorImageToFloorMatrix = [];
            for(var i=0; i<9; ++i) {
                columnMajorImageToFloorMatrix[i] = ffUi.imageToFloorMatrix.elements[i];
            }
            var str = JSON.stringify({
                columnMajorImageToFloorMatrix: columnMajorImageToFloorMatrix,
                barrelCorrection: {
                    K1: ffUi.barrelDistortion * 1e-2,
                },
            });
            var data = new Blob([str], {type:'application/json'});
            saveAs(data, 'calibration.json');
        },
    };

    // Create parameter GUI
    var gui = new dat.GUI();
    gui.add(ffUi, 'floorOpacity', 0.0, 1.0);
    gui.add(ffUi, 'floorRadius', 1, 50);
    gui.add(ffUi, 'barrelDistortion', -50, 20);
    gui.add(actions, 'download');

    function render() {
        window.requestAnimationFrame(render);
        ffUi.render();
        fpUi.render();
    }
    window.requestAnimationFrame(render);
}

// Object representing a UI for previewing a floor plane
function FloorPreviewUI(containerElement, propSource) {
    var self = this;

    self.containerElement = containerElement;
    if(typeof(self.containerElement) === 'string') {
        self.containerElement = document.getElementById(self.containerElement);
    }

    self.propSource = propSource;

    // Create container within container with position: relative to enable
    // absolute positioning within it.
    var _uiElement = document.createElement('div');
    _uiElement.style.position = 'relative';
    _uiElement.style.backgroundColor = '#bbb';
    _uiElement.style.width = '100%';
    _uiElement.style.height = '100%';
    _uiElement.style.overflow = 'hidden';
    self.containerElement.appendChild(_uiElement);

    var boardId = 'floor-preview-ui-board-' + Math.random().toString(16).slice(2);
    var floorId = 'floor-preview-ui-floor-' + Math.random().toString(16).slice(2);

    function createUIChild(id) {
        var childElement = document.createElement('div');
        childElement.id = id;
        childElement.style.position = 'absolute';
        childElement.style.width = '100%';
        childElement.style.height = '100%';
        childElement.style.top = '0';
        childElement.style.bottom = '0';
        _uiElement.appendChild(childElement);
        return childElement;
    }

    // Now create the elements for the WebGL-rendered floor and the JSXGraph
    // board.
    var floorElement = createUIChild(floorId);
    var boardElement = createUIChild(boardId);

    // Create the JSXGraph board
    self._board = JXG.JSXGraph.initBoard(boardId, {
        boundingbox: [-10, 10, 10, -10],
        axis: true, grid: true,
        keepAspectRatio: true,
        zoom: { wheel: true, },
        pan: { needShift: false },
        showCopyright: false,
    });

    self._floorRenderer = new FloorPreviewRenderer(floorElement);
    self._board.on('boundingbox', function() { self._setFloorCamera(); });
}

FloorPreviewUI.prototype.containerResized = function() {
    var elem = this.containerElement;
    this._board.renderer.resize(elem.clientWidth, elem.clientHeight);
    this._board.setBoundingBox(this._board.getBoundingBox(), true);
    this._floorRenderer.containerResized();
};

FloorPreviewUI.prototype.render = function() {
    this._floorRenderer.barrelPercent = this.propSource.barrelDistortion;
    this._floorRenderer.floorToImageMatrix.getInverse(
        this.propSource.imageToFloorMatrix
    );
    this._floorRenderer.render();
};

FloorPreviewUI.prototype.loadImage = function(texUrl) {
    var self = this;
    return this._floorRenderer.loadTexture(texUrl).then(function() {
        self._setFloorCamera();
    });
};

FloorPreviewUI.prototype._setFloorCamera = function() {
    // There's a new bounding box. Bounding boxes in JSXGraph are arrays
    // giving [left, top, right, bottom] co-ords. Use this bounding box to
    // update floor renderer.
    var bbox = this._board.getBoundingBox();
    this._floorRenderer.camera.left = bbox[0];
    this._floorRenderer.camera.top = bbox[1];
    this._floorRenderer.camera.right = bbox[2];
    this._floorRenderer.camera.bottom = bbox[3];
    this._floorRenderer.camera.updateProjectionMatrix();
    this._floorRenderer.containerResized();
};

// Create ThreeJS context for rendering floor.
function FloorPreviewRenderer(containerElement, textureUrl) {
    var self = this;

    self.containerElement = containerElement;
    self.scene = new THREE.Scene();
    self.camera = new THREE.OrthographicCamera(0, 100, 0, 100, 0, 2);
    self.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    self.floorMatrix = new THREE.Matrix3();
    self.floorOpacity = 0.25;
    self.floorRadius = 15;
    self.barrelPercent = 0.0;

    self.floorMaterial = null;
    self.floorToImageMatrix = new THREE.Matrix3();

    self.camera.position.z = 1;
    self.containerElement.appendChild(self.renderer.domElement);

    self.containerResized();
}

FloorPreviewRenderer.prototype.containerResized = function() {
    var elem = this.containerElement;
    this.renderer.setSize(elem.clientWidth, elem.clientHeight);
}

FloorPreviewRenderer.prototype.render = function() {
    var uniforms;

    if(this.floorMaterial) {
        uniforms = this.floorMaterial.uniforms;
        uniforms.barrelPercent.value = this.barrelPercent;
    }
    this.renderer.render(this.scene, this.camera);
}

FloorPreviewRenderer.prototype.loadTexture = function(textureUrl) {
    // FIXME: remove previous children from scene!
    var self = this;

    var loader = new THREE.TextureLoader();
    var texturePromise = new Promise(function(resolve, reject) {
        loader.load(textureUrl, resolve, null, reject);
    });

    texturePromise.then(function(texture) {
        texture.magFilter = THREE.NearestFilter;

        var w = texture.image.width, h = texture.image.height;
        var geometry = new THREE.PlaneGeometry(20, 20, 1, 1);

        self.floorMaterial = new THREE.ShaderMaterial({
            vertexShader: document.getElementById('previewVertexShader').textContent,
            fragmentShader: document.getElementById('previewFragmentShader').textContent,
            uniforms: {
                image: { type: 't', value: texture },
                textureSize: { type: 'v2', value: new THREE.Vector2(w, h) },
                barrelPercent: { type: 'f', value: self.barrelPercent },
                floorToImageMatrix: { type: 'm3', value: self.floorToImageMatrix },
            },
        });

        var floor = new THREE.Mesh(geometry, self.floorMaterial);
        self.scene.add(floor);
    });

    return texturePromise;
}

// Object representing a UI for finding floor planes. Takes a single element or
// element id which contains the UI.
function FloorFindUI(containerElement) {
    var self = this;

    self.containerElement = containerElement;
    if(typeof(self.containerElement) === 'string') {
        self.containerElement = document.getElementById(self.containerElement);
    }

    self.floorOpacity = 0.25;
    self.floorRadius = 20.0;
    self.barrelDistortion = 0;

    // Create container within container with position: relative to enable
    // absolute positioning within it.
    var _uiElement = document.createElement('div');
    _uiElement.style.position = 'relative';
    _uiElement.style.backgroundColor = '#888';
    _uiElement.style.width = '100%';
    _uiElement.style.height = '100%';
    _uiElement.style.overflow = 'hidden';
    self.containerElement.appendChild(_uiElement);

    var boardId = 'floor-ui-board-' + Math.random().toString(16).slice(2);
    var floorId = 'floor-ui-floor-' + Math.random().toString(16).slice(2);

    function createUIChild(id) {
        var childElement = document.createElement('div');
        childElement.id = id;
        childElement.style.position = 'absolute';
        childElement.style.width = '100%';
        childElement.style.height = '100%';
        childElement.style.top = '0';
        childElement.style.bottom = '0';
        _uiElement.appendChild(childElement);
        return childElement;
    }

    // Now create the elements for the WebGL-rendered floor and the JSXGraph
    // board.
    var floorElement = createUIChild(floorId);
    var boardElement = createUIChild(boardId);

    // Create the JSXGraph board
    self._board = JXG.JSXGraph.initBoard(boardId, {
        boundingbox: [-100, 1180, 2020, -100],
        axis: false, grid: false,
        keepAspectRatio: true,
        zoom: { wheel: true, },
        pan: { needShift: false },
        showCopyright: false,
    });

    // Create the floor-rendering context
    self._floorRenderer = new FloorRenderer(floorElement);

    // Create the JSXGraph geometry
    var w = 640, h = 480;
    var vp1 = self._board.create('point', [0, h*0.5], { name: 'VP1' });
    var vp2 = self._board.create('point', [w, h*0.5], { name: 'VP2' });
    var horizon = self._board.create('line', [vp1, vp2], { label: 'Horizon' });

    var pB = self._board.create('point', [w*0.5, h*0.125], { name: 'B' });
    var l11 = self._board.create('line', [vp1, pB],
        { straightFirst: false, fixed: true, highlight: false });
    var l12 = self._board.create('line', [vp2, pB],
        { straightFirst: false, fixed: true, highlight: false });

    var pD = self._board.create('point', [w*0.5, h*0.25], { name: 'D' });
    var l21 = self._board.create('line', [vp1, pD],
        { straightFirst: false, fixed: true, highlight: false });
    var l22 = self._board.create('line', [vp2, pD],
        { straightFirst: false, fixed: true, highlight: false });

    var pA = self._board.create('intersection', [l21, l12],
        { name: 'A', fixed: true, highlight: false });
    var pC = self._board.create('intersection', [l22, l11],
        { name: 'C', fixed: true, highlight: false });

    self._pA = pA;
    self._pB = pB;
    self._pC = pC;
    self._pD = pD;
    self._vp1 = vp1;
    self._vp2 = vp2;
    self.imageToFloorMatrix = new THREE.Matrix3();

    function setFloorCamera() {
        // There's a new bounding box. Bounding boxes in JSXGraph are arrays
        // giving [left, top, right, bottom] co-ords. Use this bounding box to
        // update floor renderer.
        var bbox = self._board.getBoundingBox();
        self._floorRenderer.camera.left = bbox[0];
        self._floorRenderer.camera.top = bbox[1];
        self._floorRenderer.camera.right = bbox[2];
        self._floorRenderer.camera.bottom = bbox[3];
        self._floorRenderer.camera.updateProjectionMatrix();
        self._floorRenderer.containerResized();
    };
    self._board.on('boundingbox', setFloorCamera);

    self.updateProjectionMatrix();
    self._board.on('update', function() { self.updateProjectionMatrix(); });
}

FloorFindUI.prototype.containerResized = function() {
    var elem = this.containerElement;
    this._board.renderer.resize(elem.clientWidth, elem.clientHeight);
    this._board.setBoundingBox(this._board.getBoundingBox(), true);
    this._floorRenderer.containerResized();
};

FloorFindUI.prototype.render = function() {
    this._floorRenderer.floorOpacity = this.floorOpacity;
    this._floorRenderer.floorRadius = this.floorRadius;
    this._floorRenderer.barrelPercent = this.barrelDistortion;
    this._floorRenderer.render();
};

FloorFindUI.prototype.loadImage = function(texUrl) {
    var self = this;
    return self._floorRenderer.loadTexture(texUrl).then(function(texture) {
        var w = texture.image.width, h = texture.image.height;
        self._board.setBoundingBox([-0.2*w, 1.2*h, 1.2*w, -0.2*h], true);
        self._vp1.setPosition(JXG.COORDS_BY_USER, [0, h*0.5]);
        self._vp2.setPosition(JXG.COORDS_BY_USER, [w, h*0.5]);
        self._pB.setPosition(JXG.COORDS_BY_USER, [w*0.5, h*0.125]);
        self._pD.setPosition(JXG.COORDS_BY_USER, [w*0.5, h*0.25]);
        self._board.update();
    });
};

FloorFindUI.prototype.updateProjectionMatrix = function() {
    var self = this;

    var H = computeHomography([
        { x: self._pA.X(), y: self._pA.Y() },
        { x: self._pB.X(), y: self._pB.Y() },
        { x: self._pC.X(), y: self._pC.Y() },
        { x: self._pD.X(), y: self._pD.Y() },
    ], [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
    ]);

    self._floorRenderer.floorMatrix.set(
        H[0], H[1], H[2],
        H[3], H[4], H[5],
        H[6], H[7], 1.0
    );
    self.imageToFloorMatrix = self._floorRenderer.floorMatrix;
};

// Create ThreeJS context for rendering floor.
function FloorRenderer(containerElement, textureUrl) {
    var self = this;

    self.containerElement = containerElement;
    self.scene = new THREE.Scene();
    self.camera = new THREE.OrthographicCamera(0, 100, 0, 100, 0, 2);
    self.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    self.floorMatrix = new THREE.Matrix3();
    self.floorOpacity = 0.25;
    self.floorRadius = 15;
    self.barrelPercent = 0.0;

    self.floorMaterial = null;
    self.imageMaterial = null;

    self.camera.position.z = 1;
    self.containerElement.appendChild(self.renderer.domElement);

    self.containerResized();
}

FloorRenderer.prototype.containerResized = function() {
    var elem = this.containerElement;
    this.renderer.setSize(elem.clientWidth, elem.clientHeight);
}

FloorRenderer.prototype.render = function() {
    var uniforms;

    if(this.floorMaterial) {
        uniforms = this.floorMaterial.uniforms;
        uniforms.floorMatrix.value = this.floorMatrix;
        uniforms.floorOpacity.value = this.floorOpacity;
        uniforms.floorRadius.value = this.floorRadius;
    }
    if(this.imageMaterial) {
        uniforms = this.imageMaterial.uniforms;
        uniforms.barrelPercent.value = this.barrelPercent;
    }
    this.renderer.render(this.scene, this.camera);
}

FloorRenderer.prototype.loadTexture = function(textureUrl) {
    // FIXME: remove previous children from scene!
    var self = this;

    var loader = new THREE.TextureLoader();
    var texturePromise = new Promise(function(resolve, reject) {
        loader.load(textureUrl, resolve, null, reject);
    });

    texturePromise.then(function(texture) {
        texture.magFilter = THREE.NearestFilter;

        var w = texture.image.width, h = texture.image.height;
        var geometry = new THREE.PlaneGeometry(w, h, 1, 1);

        self.imageMaterial = new THREE.ShaderMaterial({
            vertexShader: document.getElementById('imageVertexShader').textContent,
            fragmentShader: document.getElementById('imageFragmentShader').textContent,
            uniforms: {
                image: { type: 't', value: texture },
                textureSize: { type: 'v2', value: new THREE.Vector2(w/h, 1.0) },
                barrelPercent: { type: 'f', value: self.barrelPercent },
            },
        });

        var img = new THREE.Mesh(geometry, self.imageMaterial);
        img.position.x = w * 0.5;
        img.position.y = h * 0.5;
        self.scene.add(img);

        self.floorMaterial = new THREE.ShaderMaterial({
            vertexShader: document.getElementById('floorVertexShader').textContent,
            fragmentShader: document.getElementById('floorFragmentShader').textContent,
            uniforms: {
                floorMatrix: { type: 'm3', value: self.floorMatrix },
                floorOpacity: { type: 'f', value: self.floorOpacity },
                floorRadius: { type: 'f', value: self.floorRadius },
            },
            transparent: true,
        });

        var floor = new THREE.Mesh(geometry, self.floorMaterial);
        floor.position.x = w * 0.5;
        floor.position.y = h * 0.5;
        self.scene.add(floor);
    });

    return texturePromise;
}

// Compute 3x3 matrix H which maps image-plane to floor-plane homogenous
// co-ordinates.
//
// From:
// http://homepages.inf.ed.ac.uk/rbf/CVonline/LOCAL_COPIES/EPSRC_SSAZ/node11.html
function computeHomography(imagePoints, floorPoints) {
    if((imagePoints.length != 4) || (floorPoints.length != 4)) {
        throw new Error('Need 4 correspondences');
    }

    var x1 = imagePoints[0].x, y1 = imagePoints[0].y,
        x2 = imagePoints[1].x, y2 = imagePoints[1].y,
        x3 = imagePoints[2].x, y3 = imagePoints[2].y,
        x4 = imagePoints[3].x, y4 = imagePoints[3].y;
    var xp1 = floorPoints[0].x, yp1 = floorPoints[0].y,
        xp2 = floorPoints[1].x, yp2 = floorPoints[1].y,
        xp3 = floorPoints[2].x, yp3 = floorPoints[2].y,
        xp4 = floorPoints[3].x, yp4 = floorPoints[3].y;

    var A = [
        [ x1, y1, 1,  0,  0, 0, -xp1*x1, -xp1*y1 ],
        [  0,  0, 0, x1, y1, 1, -yp1*x1, -yp1*y1 ],
        [ x2, y2, 1,  0,  0, 0, -xp2*x2, -xp2*y2 ],
        [  0,  0, 0, x2, y2, 1, -yp2*x2, -yp2*y2 ],
        [ x3, y3, 1,  0,  0, 0, -xp3*x3, -xp3*y3 ],
        [  0,  0, 0, x3, y3, 1, -yp3*x3, -yp3*y3 ],
        [ x4, y4, 1,  0,  0, 0, -xp4*x4, -xp4*y4 ],
        [  0,  0, 0, x4, y4, 1, -yp4*x4, -yp4*y4 ],
    ];

    var b = [ xp1, yp1, xp2, yp2, xp3, yp3, xp4, yp4 ];

    return numeric.solve(A, b);
}

// Call main() function
main();

})();
