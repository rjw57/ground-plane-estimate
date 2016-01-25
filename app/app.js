(function() {

// Entry point to application. Called after all functions and variables below
// have been initialised.
function main() {
    var imgUrl = 'trumpington.png';

    var board = JXG.JSXGraph.initBoard('board', {
        boundingbox: [-100, 1180, 2020, -100],
        axis: true,
        keepAspectRatio: true,
        zoom: { wheel: true, },
        showCopyright: false,
    });

    var floorRenderer = new FloorRenderer(
        document.getElementById('floor'), imgUrl
    );

    // Create GUI
    var gui = new dat.GUI();
    gui.add(floorRenderer, 'floorOpacity', 0.0, 1.0);
    gui.add(floorRenderer, 'floorRadius', 5, 30);

    function render() {
        window.requestAnimationFrame(render);
        floorRenderer.render();
    }
    window.requestAnimationFrame(render);

    function setFloorCamera() {
        // There's a new bounding box. Bounding boxes in JSXGraph are arrays
        // giving [left, top, right, bottom] co-ords. Use this bounding box to
        // update floor renderer.
        var bbox = board.getBoundingBox();
        floorRenderer.camera.left = bbox[0];
        floorRenderer.camera.top = bbox[1];
        floorRenderer.camera.right = bbox[2];
        floorRenderer.camera.bottom = bbox[3];
        floorRenderer.camera.updateProjectionMatrix();
    };
    board.on('boundingbox', setFloorCamera);

    window.addEventListener('resize', function() {
        var elem = board.containerObj;
        board.renderer.resize(elem.clientWidth, elem.clientHeight);
        board.setBoundingBox(board.getBoundingBox(), true);
    });

    floorRenderer.texturePromise.then(function(texture) {
        var w = texture.image.width, h = texture.image.height;
        board.setBoundingBox([-0.2*w, 1.2*h, 1.2*w, -0.2*h], true);

        var vp1 = board.create('point', [0, h*0.5], { name: 'VP1' });
        var vp2 = board.create('point', [w, h*0.5], { name: 'VP2' });
        var horizon = board.create('line', [vp1, vp2], { label: 'Horizon' });

        var pB = board.create('point', [w*0.5, h*0.125], { name: 'B' });
        var l11 = board.create('line', [vp1, pB],
            { straightFirst: false, fixed: true, highlight: false });
        var l12 = board.create('line', [vp2, pB],
            { straightFirst: false, fixed: true, highlight: false });

        var pD = board.create('point', [w*0.5, h*0.25], { name: 'D' });
        var l21 = board.create('line', [vp1, pD],
            { straightFirst: false, fixed: true, highlight: false });
        var l22 = board.create('line', [vp2, pD],
            { straightFirst: false, fixed: true, highlight: false });

        var pA = board.create('intersection', [l21, l12],
            { name: 'A', fixed: true, highlight: false });
        var pC = board.create('intersection', [l22, l11],
            { name: 'C', fixed: true, highlight: false });

        function updateHomography() {
            var H = computeHomography([
                { x: pA.X(), y: pA.Y() },
                { x: pB.X(), y: pB.Y() },
                { x: pC.X(), y: pC.Y() },
                { x: pD.X(), y: pD.Y() },
            ], [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ]);

            floorRenderer.floorMatrix.set(
                H[0], H[1], H[2],
                H[3], H[4], H[5],
                H[6], H[7], 1.0
            );
        }

        board.on('update', updateHomography);
        updateHomography();
    });
}

// Create ThreeJS context for rendering floor.
function FloorRenderer(containerElement, textureUrl) {
    var self = this;

    this.containerElement = containerElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 100, 0, 100, 0, 2);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, depth: false });
    this.floorMatrix = new THREE.Matrix3();
    this.floorOpacity = 0.25;
    this.floorRadius = 15;

    this.camera.position.z = 1;
    this.containerElement.appendChild(this.renderer.domElement);

    // Wire up rendering and resize functions
    function onResize() {
        var elem = self.containerElement;
        self.renderer.setSize(elem.clientWidth, elem.clientHeight);
    }
    window.addEventListener('resize', onResize);
    onResize();

    this.render = function() {
        if(self.floorMaterial) {
            var uniforms = self.floorMaterial.uniforms;
            uniforms.floorMatrix.value = self.floorMatrix;
            uniforms.floorOpacity.value = self.floorOpacity;
            uniforms.floorRadius.value = self.floorRadius;
        }
        self.renderer.render(self.scene, self.camera);
    }

    // Load background texture
    var loader = new THREE.TextureLoader();
    this.texturePromise = new Promise(function(resolve, reject) {
        loader.load(textureUrl, resolve, null, reject);
    });

    this.texturePromise.then(function(texture) {
        texture.magFilter = THREE.NearestFilter;

        var w = texture.image.width, h = texture.image.height;
        var geometry = new THREE.PlaneGeometry(w, h, 1, 1);

        var imageMaterial = new THREE.MeshBasicMaterial({
            map: texture,
        });

        var img = new THREE.Mesh(geometry, imageMaterial);
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
