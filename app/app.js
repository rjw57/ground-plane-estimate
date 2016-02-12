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
    gui.add(ffUi, 'barrelDistortion', -50, 20);
    gui.add(state, 'xScale', 0, 3).onChange(updateFloorTransform);
    gui.add(state, 'yScale', 0, 3).onChange(updateFloorTransform);
    gui.add(state, 'xOffset', -10, 10).onChange(updateFloorTransform);
    gui.add(state, 'yOffset', -10, 10).onChange(updateFloorTransform);
    gui.add(state, 'theta', -200, 200).onChange(updateFloorTransform);
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
    this._floorRenderer.worldToCameraMatrix.copy(this.propSource.worldToCameraMatrix);
    this._floorRenderer.worldToImageMatrix.copy(this.propSource.worldToImageMatrix);
    this._floorRenderer.projectionMatrix.copy(this.propSource.projectionMatrix);
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
    self.floorMatrix = new THREE.Matrix3();
    self.floorRadius = 15;
    self.barrelPercent = 0.0;
    self.viewBounds = new THREE.Vector4(-0.5, 0.5, 0.5, -0.5);
    self.texture = null;

    self.worldToCameraMatrix = new THREE.Matrix4();
    self.worldToImageMatrix = new THREE.Matrix4();
    self.projectionMatrix = new THREE.Matrix4();

    var geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    self.floorMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('previewVertexShader').textContent,
        fragmentShader: document.getElementById('previewFragmentShader').textContent,
        uniforms: {
            image: { type: 't', value: self.texture },
            textureSize: { type: 'v2', value: new THREE.Vector2(1, 1) },
            barrelPercent: { type: 'f', value: self.barrelPercent },
            worldToImageMatrix: { type: 'm4', value: self.worldToImageMatrix },
            //worldToCameraMatrix: { type: 'm4', value: self.worldToCameraMatrix },
            //projectionMatrix: { type: 'm4', value: self.projectionMatrix },
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

    var floorVert = self._board.create('point', [w*0.5, h*0.5], { name: 'Floor' });
    var refVert = self._board.create('point', [w*0.5, h*0.75], { name: 'Ref' });

    var vertical = self._board.create('line', [floorVert, refVert],
        { name: 'Vertical', straightFirst: false, straightLast: false });

    self._pA = pA;
    self._pB = pB;
    self._pC = pC;
    self._pD = pD;
    self._vp1 = vp1;
    self._vp2 = vp2;
    self._floorVert = floorVert;
    self._refVert = refVert;
    self.referenceHeight = 0.5;
    self.imageToFloorMatrix = new THREE.Matrix3();

    self.worldToCameraMatrix = new THREE.Matrix4();
    self.worldToImageMatrix = new THREE.Matrix4();
    self.projectionMatrix = new THREE.Matrix4();

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

FloorFindUI.prototype.updateProjectionMatrix = function() {
    var self = this, i, j, A, Ainv;

    // We want to map from our construction points to a full 3D model. First of
    // all we will reconstruct the (invertable) projective mapping from our 4
    // floor points, { A, B, C, D } to the world floor plane.

    // Construct matrix of transformed floor points.
    var floorPoints = numeric.dot(
        self.getFloorPlaneTransform(),
        [
            [1, 0, 0, 1],
            [0, 0, 1, 1],
            [1, 1, 1, 1],
        ]
    );

    for(i=0; i<4; ++i) {
        var w = floorPoints[2][i];
        for(j=0; j<3; ++j) {
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

    self._floorRenderer.floorMatrix.set(
        H[0], H[1], H[2],
        H[3], H[4], H[5],
        H[6], H[7], 1.0
    );

    // imageToFloorMatrix is a 3x3 invertable matrix which maps from the image
    // plane to the floor plane.
    self.imageToFloorMatrix = self._floorRenderer.floorMatrix;

    // The imageToFloorMatrix matrix is invertable.
    A = [
        [H[0], H[1], H[2]],
        [H[3], H[4], H[5]],
        [H[6], H[7], 1.0],
    ];

    // Use imageToFloorMatrix to map from the image plane "floor" vertex to the
    // floor plane.
    var floorVertWorld = numeric.dot(A,
        [self._floorVert.X(), self._floorVert.Y(), 1]
    );
    for(i=0; i<3; i++) { floorVertWorld[i] /= floorVertWorld[2]; }

    // We can now stack up our list of correspondences.
    var worldPoints = [], imagePoints = [];

    // Floor A, B, C, D
    imagePoints.push([self._pA.X(), self._pA.Y()]);
    worldPoints.push([floorPoints[0][0], floorPoints[1][0], 0]);
    imagePoints.push([self._pB.X(), self._pB.Y()]);
    worldPoints.push([floorPoints[0][1], floorPoints[1][1], 0]);
    imagePoints.push([self._pC.X(), self._pC.Y()]);
    worldPoints.push([floorPoints[0][2], floorPoints[1][2], 0]);
    imagePoints.push([self._pD.X(), self._pD.Y()]);
    worldPoints.push([floorPoints[0][3], floorPoints[1][3], 0]);

    // Reference vertical
    imagePoints.push([self._floorVert.X(), self._floorVert.Y()]);
    worldPoints.push([floorVertWorld[0], floorVertWorld[1], 0]);
    imagePoints.push([self._refVert.X(), self._refVert.Y()]);
    worldPoints.push([floorVertWorld[0], floorVertWorld[1], self.referenceHeight]);

    // Camera calibration taken from
    // http://research.microsoft.com/en-us/um/people/zhang/Papers/Camera%20Calibration%20-%20book%20chapter.pdf
    // (with sign errors corrected...)

    var G = [];
    for(i=0; i<imagePoints.length; ++i) {
        var I = imagePoints[i], W = worldPoints[i];
        G.push([
            W[0], W[1], W[2], 1, 0, 0, 0, 0, -I[0]*W[0], -I[0]*W[1], -I[0]*W[2], -I[0]
        ]);
        G.push([
            0, 0, 0, 0, W[0], W[1], W[2], 1, -I[1]*W[0], -I[1]*W[1], -I[1]*W[2], -I[1]
        ]);
    }

    // P is eigenvector of G^T G associated with smallest eigenvector
    var GtG = numeric.dot(numeric.transpose(G), G);

    var eigsol = numeric.eig(GtG);
    var minidx = 0, minl = Math.abs(eigsol.lambda.x[0]);
    for(i=0; i<eigsol.lambda.x.length; ++i) {
        if(Math.abs(eigsol.lambda.x[i]) < minl) {
            minidx = i; minl = Math.abs(eigsol.lambda.x[i]);
        }
    }
    var Pvec = numeric.transpose(eigsol.E.x)[minidx];

    // Normalise P
    Pvec = numeric.div(Pvec, Math.sqrt(Pvec[8]*Pvec[8] + Pvec[9]*Pvec[9] + Pvec[10]*Pvec[10]));
    Pvec = numeric.mul(Pvec, Math.sign(Pvec[11]));

    // Extract projection matrix (A), rotation (R) and translation (t) such that
    // P = A[R t]. Let B = AR, b = At.

    var B = [
        [Pvec[0], Pvec[1], Pvec[2]],
        [Pvec[4], Pvec[5], Pvec[6]],
        [Pvec[8], Pvec[9], Pvec[10]]
    ];

    var b = [Pvec[3], Pvec[7], Pvec[11]];

    // Construct and normalise K = BB^T = AA^T
    var K = numeric.dot(B, numeric.transpose(B));
    var norm = K[2][2];

    K = numeric.div(K, norm);
    B = numeric.div(B, norm);
    b = numeric.div(b, norm);

    // Closed form solution for A
    var u_0 = K[0][2], v_0 = K[1][2], k_u = K[0][0], k_c = K[0][1], k_v = K[1][1];

    // Check for no solution
    if(v_0*v_0 > k_v) { return; }
    var beta = Math.sqrt(k_v - v_0*v_0);
    var gamma = (k_c - u_0*v_0) / beta;

    if(u_0*u_0 + gamma*gamma > k_u) { return; }
    var alpha = Math.sqrt(k_u - u_0*u_0 - gamma*gamma);

    A = [
        [alpha, gamma, u_0],
        [0, beta, v_0],
        [0, 0, 1],
    ];
    Ainv = numeric.inv(A);

    var R = numeric.dot(Ainv, B), t = numeric.dot(Ainv, b);

    console.log('---');
    console.log(R);
    console.log(t);
    console.log(A);

    self.worldToCameraMatrix.set(
        R[0][0], R[0][1], R[0][2], t[0],
        R[1][0], R[1][1], R[1][2], t[1],
        R[2][0], R[2][1], R[2][2], t[2],
        0, 0, 0, 1
    );

    self.projectionMatrix.set(
        A[0][0], A[0][1], A[0][2], 0,
        A[1][0], A[1][1], A[1][2], 0,
        A[2][0], A[2][1], A[2][2], 0,
        0, 0, 0, 1
    );

    self.worldToImageMatrix.set(
        Pvec[0], Pvec[1], Pvec[2], Pvec[3],
        Pvec[4], Pvec[5], Pvec[6], Pvec[7],
        0, 0, 1, 0,
        Pvec[8], Pvec[9], Pvec[10], Pvec[11]
    );
};

// Create ThreeJS context for rendering floor.
function FloorRenderer(containerElement, textureUrl) {
    var self = this;

    self.containerElement = containerElement;
    self.scene = new THREE.Scene();
    self.camera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 2);
    self.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    self.floorMatrix = new THREE.Matrix3();
    self.floorOpacity = 0.25;
    self.floorRadius = 15;
    self.barrelPercent = 0.0;
    self.viewBounds = new THREE.Vector4(-0.5, 0.5, 0.5, -0.5);

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
    self.scene.add(img);

    self.floorMaterial = new THREE.ShaderMaterial({
        vertexShader: document.getElementById('floorVertexShader').textContent,
        fragmentShader: document.getElementById('floorFragmentShader').textContent,
        uniforms: {
            viewBounds: { type: 'v4', value: self.viewBounds },
            floorMatrix: { type: 'm3', value: self.floorMatrix },
            floorOpacity: { type: 'f', value: self.floorOpacity },
            floorRadius: { type: 'f', value: self.floorRadius },
        },
        transparent: true,
    });

    var floor = new THREE.Mesh(geometry, self.floorMaterial);
    self.scene.add(floor);

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

    uniforms = this.floorMaterial.uniforms;
    uniforms.floorMatrix.value = this.floorMatrix;
    uniforms.floorOpacity.value = this.floorOpacity;
    uniforms.floorRadius.value = this.floorRadius;

    uniforms = this.imageMaterial.uniforms;
    uniforms.barrelPercent.value = this.barrelPercent;
    uniforms.image.value = this.texture;

    if(this.texture) {
        var w = this.texture.image.width, h = this.texture.image.height;
        uniforms.textureSize.value.set(w, h);
    }

    this.renderer.render(this.scene, this.camera);
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
