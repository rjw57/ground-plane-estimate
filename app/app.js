(function() {

// Entry point to application. Called after all functions and variables below
// have been initialised.
function main() {
    var imgUrl = 'trumpington.png';

    Split(['#floor-pane', '#image-pane'], {
        gutterSize: 8,
        cursor: 'col-resize',
        onDrag: onUiResize,
        sizes: [33, 67],
    });

    ffUi = new FloorFindUI('image-ui');
    fpUi = new FloorPreviewUI('floor-preview', ffUi);

    var loader = new THREE.TextureLoader();
    var texPromise = new Promise(function(resolve, reject) {
        loader.load(imgUrl, resolve, null, reject);
    });

    texPromise.then(function(texture) {
        texture.magFilter = THREE.NearestFilter;
        ffUi.texture = texture;
        ffUi.initialiseFromTexture();
        fpUi.texture = texture;
    });

    function onUiResize() {
        ffUi.containerResized();
        fpUi.containerResized();
    }
    window.addEventListener('resize', onUiResize);

    var actions = {
        download: function() {
            // makes use of saveAs function from FileSaver.min.js.
            var columnMajorImageToFloorMatrix = [];
            for(var i=0; i<9; ++i) {
                columnMajorImageToFloorMatrix[i] = ffUi.imageToFloorMatrix.elements[i];
            }
            var str = ffUi.toJSON();
            var data = new Blob([str], {type:'application/json'});
            saveAs(data, 'calibration.json');
        },
    };

    var state = {
        xScale: 1, yScale: 1,
        xOffset: 0, yOffset: 0,
        theta: 0,
    };

    function updateFloorTransform() {
        var s = state;

        var scale = [
            [s.xScale, 0, 0],
            [0, s.yScale, 0],
            [0, 0, 1],
        ];

        var shift = [
            [1, 0, s.xOffset],
            [0, 1, s.yOffset],
            [0, 0, 1],
        ];

        var thetaRad = 2.0 * Math.PI * (s.theta / 360.0);
        var ct = Math.cos(thetaRad), st = Math.sin(thetaRad);
        var rot = [
            [ct, -st, 0],
            [st, ct, 0],
            [0, 0, 1],
        ];

        ffUi.setFloorPlaneTransform(
            numeric.dot(rot, numeric.dot(scale, shift))
        );
    }

    // Create parameter GUI
    var gui = new dat.GUI();
    gui.add(ffUi, 'floorOpacity', 0.0, 1.0);
    gui.add(ffUi, 'floorRadius', 1, 50);
    gui.add(ffUi, 'barrelDistortion', -0.50, 0.20);
    gui.add(state, 'xScale', 0, 3).onChange(updateFloorTransform);
    gui.add(state, 'yScale', 0, 3).onChange(updateFloorTransform);
    gui.add(state, 'xOffset', -10, 10).onChange(updateFloorTransform);
    gui.add(state, 'yOffset', -10, 10).onChange(updateFloorTransform);
    gui.add(state, 'theta', -200, 200).onChange(updateFloorTransform);
    gui.add(ffUi, 'referenceHeight1', 0, 1).onChange(updateFloorTransform);
    gui.add(ffUi, 'referenceHeight2', 0, 1).onChange(updateFloorTransform);
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
    self.texture = null;

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
    //self._board.on('boundingbox', function() { self._setFloorCamera(); });
}

FloorPreviewUI.prototype.containerResized = function() {
    var elem = this.containerElement;
    this._board.renderer.resize(elem.clientWidth, elem.clientHeight);
    this._board.setBoundingBox(this._board.getBoundingBox(), true);
    this._floorRenderer.containerResized();
};

FloorPreviewUI.prototype.render = function() {
    var bbox = this._board.getBoundingBox();
    this._floorRenderer.camera.updateProjectionMatrix();
    this._floorRenderer.viewBounds.set(bbox[0], bbox[1], bbox[2], bbox[3]);
    this._floorRenderer.containerResized();

    this._floorRenderer.barrelPercent = this.propSource.barrelDistortion;
    this._floorRenderer.worldToImageMatrix.copy(this.propSource.worldToImageMatrix);
    this._floorRenderer.floorRadius = this.propSource.floorRadius;
    this._floorRenderer.texture = this.texture;
    this._floorRenderer.render();
};

// Create ThreeJS context for rendering floor.
function FloorPreviewRenderer(containerElement, textureUrl) {
    var self = this;

    self.containerElement = containerElement;
    self.scene = new THREE.Scene();
    self.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
    self.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    self.imageToFloorMatrix = new THREE.Matrix3();
    self.floorRadius = 15;
    self.barrelPercent = 0.0;
    self.viewBounds = new THREE.Vector4(-0.5, 0.5, 0.5, -0.5);
    self.texture = null;

    self.worldToImageMatrix = new THREE.Matrix4();

    var geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    self.floorMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('previewVertexShader').textContent,
        fragmentShader: document.getElementById('previewFragmentShader').textContent,
        uniforms: {
            image: { type: 't', value: self.texture },
            textureSize: { type: 'v2', value: new THREE.Vector2(1, 1) },
            barrelPercent: { type: 'f', value: self.barrelPercent },
            worldToImageMatrix: { type: 'm4', value: self.worldToImageMatrix },
            viewBounds: { type: 'v4', value: self.viewBounds },
            floorRadius: { type: 'f', value: self.floorRadius },
        },
    });
    var floor = new THREE.Mesh(geometry, self.floorMaterial);
    self.scene.add(floor);

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

    uniforms = this.floorMaterial.uniforms;
    uniforms.barrelPercent.value = this.barrelPercent;
    uniforms.floorRadius.value = this.floorRadius;
    uniforms.image.value = this.texture;

    if(this.texture) {
        var w = this.texture.image.width, h = this.texture.image.height;
        uniforms.textureSize.value.set(w, h);
    }
    this.renderer.render(this.scene, this.camera);
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
    self._projectionMatrix = [];

    // Affine transform to apply to floor plane.
    var floorPlaneTransform = numeric.identity(3);
    self.getFloorPlaneTransform = function() { return floorPlaneTransform; }
    self.setFloorPlaneTransform = function(t) {
        floorPlaneTransform = t;
        this.updateProjectionMatrix();
    }

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

    self._refVert1Floor = self._board.create('point', [w*0.25, h*0.25], { name: 'Floor' });
    self._refVert2Floor = self._board.create('point', [w*0.75, h*0.25], { name: 'Floor' });
    self._refVert1 = self._board.create('point', [w*0.25, h*0.75], { name: 'Vertical' });
    self._refVert2 = self._board.create('point', [w*0.75, h*0.75], { name: 'Vertical' });
    self.referenceHeight1 = 0.4;
    self.referenceHeight2 = 0.4;

    self._board.create('line', [self._refVert1Floor, self._refVert1], {
        straightFirst: false, straightLast: false
    });
    self._board.create('line', [self._refVert2Floor, self._refVert2], {
        straightFirst: false, straightLast: false
    });

    self.imageToFloorMatrix = new THREE.Matrix3();
    self.worldToImageMatrix = new THREE.Matrix4();

    function setFloorCamera() {
        // There's a new bounding box. Bounding boxes in JSXGraph are arrays
        // giving [left, top, right, bottom] co-ords. Use this bounding box to
        // update floor renderer.
        var bbox = self._board.getBoundingBox();
        self._floorRenderer.camera.updateProjectionMatrix();
        self._floorRenderer.viewBounds.set(bbox[0], bbox[1], bbox[2], bbox[3]);
        self._floorRenderer.containerResized();
    };
    self._board.on('boundingbox', setFloorCamera);

    self.updateProjectionMatrix();
    self._board.on('update', function() { self.updateProjectionMatrix(); });
}

FloorFindUI.prototype.toJSON = function() {
    return JSON.stringify({
        controlPoints: {
            A: [ this._pA.X(), this._pA.Y() ],
            B: [ this._pA.X(), this._pA.Y() ],
            C: [ this._pA.X(), this._pA.Y() ],
            D: [ this._pA.X(), this._pA.Y() ],
            VP1: [ this._vp1.X(), this._vp1.Y() ],
            VP2: [ this._vp2.X(), this._vp2.Y() ],
            Vert1Floor: [ this._refVert1Floor.X(), this._refVert1Floor.Y() ],
            Vert2Floor: [ this._refVert2Floor.X(), this._refVert2Floor.Y() ],
            Vert1Top: [ this._refVert1.X(), this._refVert1.Y() ],
            Vert2Top: [ this._refVert2.X(), this._refVert2.Y() ],
        },
        controlValues: {
            referenceHeight1: this.referenceHeight1,
            referenceHeight2: this.referenceHeight2,
        },
        pointCorrespondences: this.pointCorrespondences(),
        projectionMatrix: this._projectionMatrix,
        barrelCorrection: {
            K1: this.barrelDistortion,
        },
    });
};

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
    this._floorRenderer.texture = this.texture;
    this._floorRenderer.render();
};

FloorFindUI.prototype.initialiseFromTexture = function() {
    var self = this;
    var w = self.texture.image.width, h = self.texture.image.height;
    self._board.setBoundingBox([-0.2*w, 1.2*h, 1.2*w, -0.2*h], true);
    self._vp1.setPosition(JXG.COORDS_BY_USER, [0, h*0.5]);
    self._vp2.setPosition(JXG.COORDS_BY_USER, [w, h*0.5]);
    self._pB.setPosition(JXG.COORDS_BY_USER, [w*0.5, h*0.125]);
    self._pD.setPosition(JXG.COORDS_BY_USER, [w*0.5, h*0.25]);
    self._board.update();
};

FloorFindUI.prototype.pointCorrespondences = function() {
    var self = this;

    // Firstly compute the image-space to floor plane matrix:

    var floorPoints = numeric.dot(
        self.getFloorPlaneTransform(),
        [
            [1, 0, 0, 1],
            [0, 0, 1, 1],
            [1, 1, 1, 1],
        ]
    );

    for(var i=0; i<4; ++i) {
        var w = floorPoints[2][i];
        for(var j=0; j<3; ++j) {
            floorPoints[j][i] /= w;
        }
    }

    var H = computeHomography([
        { x: self._pA.X(), y: self._pA.Y() },
        { x: self._pB.X(), y: self._pB.Y() },
        { x: self._pC.X(), y: self._pC.Y() },
        { x: self._pD.X(), y: self._pD.Y() },
    ], [
        { x: floorPoints[0][0], y: floorPoints[1][0] },
        { x: floorPoints[0][1], y: floorPoints[1][1] },
        { x: floorPoints[0][2], y: floorPoints[1][2] },
        { x: floorPoints[0][3], y: floorPoints[1][3] },
    ]);

    var imageToFloor = [
        [H[0], H[1], H[2]],
        [H[3], H[4], H[5]],
        [H[6], H[7], 1.0]
    ];

    // Use the image to floor matrix to compute the floor-plane co-ordinates of
    // the reference verticals.
    var refVert1Floor = numeric.dot(imageToFloor, [
        self._refVert1Floor.X(), self._refVert1Floor.Y(), 1
    ]);
    refVert1Floor = numeric.div(refVert1Floor, refVert1Floor[2]);

    var refVert2Floor = numeric.dot(imageToFloor, [
        self._refVert2Floor.X(), self._refVert2Floor.Y(), 1
    ]);
    refVert2Floor = numeric.div(refVert2Floor, refVert2Floor[2]);

    // We can now compute a list of image-space and world-space correspondences.
    var imagePoints = [], worldPoints = [];
    imagePoints.push([self._pA.X(), self._pA.Y()]);
    imagePoints.push([self._pB.X(), self._pB.Y()]);
    imagePoints.push([self._pC.X(), self._pC.Y()]);
    imagePoints.push([self._pD.X(), self._pD.Y()]);
    for(var i=0; i<4; ++i) {
        worldPoints.push([floorPoints[0][i], floorPoints[1][i], 0]);
    }

    imagePoints.push([self._refVert1Floor.X(), self._refVert1Floor.Y()]);
    imagePoints.push([self._refVert1.X(), self._refVert1.Y()]);
    worldPoints.push([refVert1Floor[0], refVert1Floor[1], 0]);
    worldPoints.push([refVert1Floor[0], refVert1Floor[1], self.referenceHeight1]);

    imagePoints.push([self._refVert2Floor.X(), self._refVert2Floor.Y()]);
    imagePoints.push([self._refVert2.X(), self._refVert2.Y()]);
    worldPoints.push([refVert2Floor[0], refVert2Floor[1], 0]);
    worldPoints.push([refVert2Floor[0], refVert2Floor[1], self.referenceHeight1]);

    return { image: imagePoints, world: worldPoints };
}

FloorFindUI.prototype.updateProjectionMatrix = function() {
    var self = this;
    var correspondences = self.pointCorrespondences();

    var imagePoints = correspondences.image, worldPoints = correspondences.world;

    // We can now form the camera calibration problem as outlined in
    // http://research.microsoft.com/en-us/um/people/zhang/Papers/Camera%20Calibration%20-%20book%20chapter.pdf
    // (With sign errors corrected)

    var G = [];
    for(i=0; i<imagePoints.length; ++i) {
        var X = worldPoints[i], x = imagePoints[i];
        G.push([
            X[0], X[1], X[2], 1, 0, 0, 0, 0, -x[0]*X[0], -x[0]*X[1], -x[0]*X[2], -x[0]
        ]);
        G.push([
            0, 0, 0, 0, X[0], X[1], X[2], 1, -x[1]*X[0], -x[1]*X[1], -x[1]*X[2], -x[1]
        ]);
    }

    var GtG = numeric.dot(numeric.transpose(G), G);
    var eigsol = numeric.eig(GtG);
    var absLambda = eigsol.lambda.abs().x;
    var minidx = 0, minval = absLambda[0];
    for(i=0; i<absLambda.length; ++i) {
        if(absLambda[i] < minval) {
            minidx = i; minval = absLambda[i];
        }
    }

    // Projection matrix coefficients are eigenvector with minimum eigenvalue:
    var Pvec = numeric.transpose(eigsol.E.x)[minidx];

    // Normalise s.t. p31^2 + p32^2 + p33^2 = 1 and p34 +ve
    Pvec = numeric.div(Pvec, Math.sqrt(Pvec[8]*Pvec[8] + Pvec[9]*Pvec[9] + Pvec[10]*Pvec[10]));
    Pvec = numeric.mul(Pvec, Math.sign(Pvec[11]));

    var P = [
        [Pvec[0], Pvec[1], Pvec[2], Pvec[3]],
        [Pvec[4], Pvec[5], Pvec[6], Pvec[7]],
        [Pvec[8], Pvec[9], Pvec[10], Pvec[11]]
    ];

    // Form subset of matrix P which acts on world co-ordinate == 0
    var floorToImage = [
        [P[0][0], P[0][1], P[0][3]],
        [P[1][0], P[1][1], P[1][3]],
        [P[2][0], P[2][1], P[2][3]],
    ];
    var imageToFloor = numeric.inv(floorToImage);

    self._floorRenderer.imageToFloorMatrix.set(
        imageToFloor[0][0], imageToFloor[0][1], imageToFloor[0][2],
        imageToFloor[1][0], imageToFloor[1][1], imageToFloor[1][2],
        imageToFloor[2][0], imageToFloor[2][1], imageToFloor[2][2]
    );

    self.imageToFloorMatrix = self._floorRenderer.imageToFloorMatrix;
    self.worldToImageMatrix.set(
        P[0][0], P[0][1], P[0][2], P[0][3],
        P[1][0], P[1][1], P[1][2], P[1][3],
        0, 0, 1, 0,
        P[2][0], P[2][1], P[2][2], P[2][3]
    );
    self._floorRenderer.worldToImageMatrix.copy(self.worldToImageMatrix);
    self._projectionMatrix = P;
};

// Create ThreeJS context for rendering floor.
function FloorRenderer(containerElement, textureUrl) {
    var self = this;

    self.containerElement = containerElement;
    self.floorScene = new THREE.Scene();
    self.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
    self.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    self.floorOpacity = 0.25;
    self.floorRadius = 15;
    self.barrelPercent = 0.0;
    self.viewBounds = new THREE.Vector4(-0.5, 0.5, 0.5, -0.5);

    // Matrices
    self.imageToFloorMatrix = new THREE.Matrix3();
    self.imageToViewportMatrix = new THREE.Matrix4();
    self.worldToImageMatrix = new THREE.Matrix4();
    self._worldToViewportMatrix = new THREE.Matrix4();

    self.texture = null;

    var geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

    self.imageMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('imageVertexShader').textContent,
        fragmentShader: document.getElementById('imageFragmentShader').textContent,
        uniforms: {
            viewBounds: { type: 'v4', value: self.viewBounds },
            image: { type: 't', value: self.texture },
            textureSize: { type: 'v2', value: new THREE.Vector2(1, 1) },
            barrelPercent: { type: 'f', value: self.barrelPercent },
        },
    });

    var img = new THREE.Mesh(geometry, self.imageMaterial);
    self.floorScene.add(img);

    self.floorMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('floorVertexShader').textContent,
        fragmentShader: document.getElementById('floorFragmentShader').textContent,
        uniforms: {
            viewBounds: { type: 'v4', value: self.viewBounds },
            imageToFloorMatrix: { type: 'm3', value: self.imageToFloorMatrix },
            floorOpacity: { type: 'f', value: self.floorOpacity },
            floorRadius: { type: 'f', value: self.floorRadius },
        },
        transparent: true,
    });

    var floor = new THREE.Mesh(geometry, self.floorMaterial);
    self.floorScene.add(floor);

    self.axisScene = new THREE.Scene();
    self.axisCamera = new THREE.Camera();

    //self.axisCamera = new THREE.PerspectiveCamera(90, 1, 1, 10000);
    //self.axisCamera.position.z = 5;

    self.axisScene.add(new THREE.ArrowHelper(
        new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0),
        1, 0xff0000, 0.2, 0.1
    ));
    self.axisScene.add(new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0),
        1, 0x00ff00, 0.2, 0.1
    ));
    self.axisScene.add(new THREE.ArrowHelper(
        new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0),
        1, 0x0000ff, 0.2, 0.1
    ));

    self.camera.position.z = 1;
    self.containerElement.appendChild(self.renderer.domElement);

    self.containerResized();
}

FloorRenderer.prototype.containerResized = function() {
    var elem = this.containerElement;
    this.renderer.setSize(elem.clientWidth, elem.clientHeight);
}

FloorRenderer.prototype.render = function() {
    // Re-calculate the image -> viewport matrix from the [left, top, right,
    // bottom] bounds.
    var bounds = this.viewBounds;
    var w = bounds.z - bounds.x, h = bounds.y - bounds.w;
    var cx = 0.5*(bounds.z + bounds.x), cy = 0.5*(bounds.y + bounds.w);
    this.imageToViewportMatrix.set(
        2/w, 0, 0, -2*cx/w,
        0, 2/h, 0, -2*cy/h,
        0, 0, 1, 0,
        0, 0, 0, 1
    );

    this._worldToViewportMatrix.multiplyMatrices(
        this.imageToViewportMatrix, this.worldToImageMatrix);
    this.axisCamera.projectionMatrix.copy(this._worldToViewportMatrix);

    var uniforms;

    uniforms = this.floorMaterial.uniforms;
    uniforms.imageToFloorMatrix.value = this.imageToFloorMatrix;
    uniforms.floorOpacity.value = this.floorOpacity;
    uniforms.floorRadius.value = this.floorRadius;

    uniforms = this.imageMaterial.uniforms;
    uniforms.barrelPercent.value = this.barrelPercent;
    uniforms.image.value = this.texture;

    if(this.texture) {
        var w = this.texture.image.width, h = this.texture.image.height;
        uniforms.textureSize.value.set(w, h);
    }

    this.renderer.autoClearColor = false;
    this.renderer.render(this.floorScene, this.camera);
    this.renderer.render(this.axisScene, this.axisCamera);
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
