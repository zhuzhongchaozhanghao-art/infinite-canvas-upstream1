import * as THREE from 'three';

export type PoseId = 'neutral' | 'pocket' | 'walk' | 'turn' | 'sit';
export type Framing = 'full' | 'half' | 'close';

export const POSE_OPTIONS: { id: PoseId; label: string }[] = [
    { id: 'neutral', label: '自然站立' },
    { id: 'pocket', label: '插兜站姿' },
    { id: 'walk', label: '向前跨步' },
    { id: 'turn', label: '回身站立' },
    { id: 'sit', label: '盘腿坐姿' },
];

export const FRAME_OPTIONS: { id: Framing; label: string }[] = [
    { id: 'full', label: '全身' },
    { id: 'half', label: '半身' },
    { id: 'close', label: '近景' },
];

type Point = [number, number, number];
type Joint = 'head' | 'neck' | 'shoulderL' | 'shoulderR' | 'elbowL' | 'elbowR' | 'wristL' | 'wristR'
    | 'hipL' | 'hipR' | 'kneeL' | 'kneeR' | 'ankleL' | 'ankleR' | 'toeL' | 'toeR';
type Skeleton = Record<Joint, Point>;
type Preset = { joints: Partial<Skeleton>; torsoYaw?: number; headYaw?: number };

const BASE: Skeleton = {
    head: [0, 2.13, 0], neck: [0, 1.9, 0],
    shoulderL: [-0.29, 1.83, 0], shoulderR: [0.29, 1.83, 0],
    elbowL: [-0.4, 1.43, 0.03], elbowR: [0.4, 1.43, 0.03],
    wristL: [-0.42, 1.06, 0.06], wristR: [0.42, 1.06, 0.06],
    hipL: [-0.18, 1.05, 0], hipR: [0.18, 1.05, 0],
    kneeL: [-0.19, 0.57, 0.04], kneeR: [0.19, 0.57, 0.04],
    ankleL: [-0.19, 0.13, 0.08], ankleR: [0.19, 0.13, 0.08],
    toeL: [-0.19, 0.07, 0.29], toeR: [0.19, 0.07, 0.29],
};

const PRESETS: Record<PoseId, Preset> = {
    neutral: { joints: {} },
    pocket: {
        joints: {
            elbowR: [0.47, 1.47, 0.08], wristR: [0.18, 1.1, 0.23],
            hipR: [0.21, 1.05, 0.02], kneeR: [0.13, 0.57, 0.12],
            ankleR: [-0.05, 0.13, 0.26], toeR: [-0.08, 0.07, 0.48],
            kneeL: [-0.22, 0.57, -0.04],
        },
    },
    walk: {
        joints: {
            elbowL: [-0.43, 1.48, -0.15], wristL: [-0.31, 1.17, -0.35],
            elbowR: [0.42, 1.46, 0.18], wristR: [0.35, 1.17, 0.42],
            kneeL: [-0.2, 0.64, 0.43], ankleL: [-0.22, 0.14, 0.73], toeL: [-0.23, 0.07, 0.96],
            kneeR: [0.2, 0.62, -0.31], ankleR: [0.2, 0.13, -0.54], toeR: [0.2, 0.07, -0.34],
        },
        torsoYaw: -0.12,
    },
    turn: {
        joints: {
            shoulderL: [-0.24, 1.83, 0.16], shoulderR: [0.24, 1.83, -0.16],
            elbowL: [-0.33, 1.42, 0.2], wristL: [-0.31, 1.04, 0.22],
            elbowR: [0.34, 1.44, -0.13], wristR: [0.38, 1.1, 0.04],
            hipL: [-0.18, 1.05, -0.06], hipR: [0.18, 1.05, 0.06],
            kneeR: [0.27, 0.56, 0.12], ankleR: [0.33, 0.13, 0.21], toeR: [0.34, 0.07, 0.42],
        },
        torsoYaw: 0.5, headYaw: 0.8,
    },
    sit: {
        joints: {
            head: [0, 1.4, 0], neck: [0, 1.17, 0],
            shoulderL: [-0.29, 1.1, 0], shoulderR: [0.29, 1.1, 0],
            elbowL: [-0.42, 0.68, 0.14], elbowR: [0.42, 0.68, 0.14],
            wristL: [-0.5, 0.27, 0.48], wristR: [0.5, 0.27, 0.48],
            hipL: [-0.18, 0.35, 0], hipR: [0.18, 0.35, 0],
            kneeL: [-0.52, 0.22, 0.46], kneeR: [0.52, 0.22, 0.46],
            ankleL: [0.09, 0.11, 0.58], ankleR: [-0.09, 0.11, 0.58],
            toeL: [0.25, 0.08, 0.72], toeR: [-0.25, 0.08, 0.72],
        },
    },
};

export type StageSettings = { pose: PoseId; yaw: number; pitch: number; framing: Framing };

export function createMannequinStage(initial: StageSettings) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f8f9);
    const camera = new THREE.PerspectiveCamera(35, 3 / 4, 0.1, 80);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    const body = new THREE.MeshStandardMaterial({ color: 0xe9eae8, roughness: 0.83 });
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d9de, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4;
    key.shadow.camera.right = 4;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -4;
    key.shadow.bias = -0.0002;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xe2e8f4, 0.5);
    fill.position.set(-4, 3, -3);
    scene.add(fill);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.ShadowMaterial({ color: 0x5b616b, opacity: 0.14 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.015;
    floor.receiveShadow = true;
    scene.add(floor);

    let model: THREE.Group | null = null;
    let settings = initial;
    let width = 240;
    let height = 320;

    const point = (coords: Point) => new THREE.Vector3(...coords);
    const addPart = (group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position: THREE.Vector3) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.castShadow = true;
        group.add(mesh);
        return mesh;
    };
    const ellipse = (group: THREE.Group, coords: Point, scale: Point) => {
        const mesh = addPart(group, new THREE.SphereGeometry(1, 24, 18), body, point(coords));
        mesh.scale.set(...scale);
        return mesh;
    };
    const loft = (group: THREE.Group, sections: Point[], position: Point) => {
        const curve = new THREE.CatmullRomCurve3(sections.map(point));
        const steps = (sections.length - 1) * 4;
        const sides = 24;
        const vertices: number[] = [];
        const indices: number[] = [];
        for (let i = 0; i <= steps; i++) {
            const { x, y, z } = curve.getPoint(i / steps);
            for (let j = 0; j < sides; j++) {
                const angle = j * Math.PI * 2 / sides;
                vertices.push(Math.cos(angle) * Math.max(x, 0.001), y, Math.sin(angle) * Math.max(z, 0.001));
                if (i === steps) continue;
                const a = i * sides + j;
                const b = i * sides + (j + 1) % sides;
                const c = a + sides;
                const d = b + sides;
                indices.push(a, c, b, b, c, d);
            }
        }
        const first = sections[0];
        const last = sections[sections.length - 1];
        const bottom = vertices.length / 3;
        vertices.push(0, first[1], 0, 0, last[1], 0);
        for (let j = 0; j < sides; j++) {
            indices.push(bottom, j, (j + 1) % sides);
            indices.push(bottom + 1, steps * sides + (j + 1) % sides, steps * sides + j);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        return addPart(group, geometry, body, point(position));
    };
    const limb = (group: THREE.Group, joints: Point[], radii: [number, number][]) => {
        const curve = new THREE.CatmullRomCurve3(joints.map(point));
        const steps = 24;
        const sides = 16;
        const frames = curve.computeFrenetFrames(steps, false);
        const vertices: number[] = [];
        const indices: number[] = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const center = curve.getPointAt(t);
            const next = radii.findIndex(([at]) => at >= t);
            const before = radii[Math.max(0, next - 1)];
            const after = radii[next < 0 ? radii.length - 1 : next];
            const radius = THREE.MathUtils.lerp(before[1], after[1], before === after ? 0 : (t - before[0]) / (after[0] - before[0]));
            for (let j = 0; j < sides; j++) {
                const angle = j * Math.PI * 2 / sides;
                const position = center.clone()
                    .addScaledVector(frames.normals[i], Math.cos(angle) * radius)
                    .addScaledVector(frames.binormals[i], Math.sin(angle) * radius);
                vertices.push(position.x, position.y, position.z);
                if (i === steps) continue;
                const a = i * sides + j;
                const b = i * sides + (j + 1) % sides;
                const c = a + sides;
                const d = b + sides;
                indices.push(a, b, c, b, d, c);
            }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        addPart(group, geometry, body, new THREE.Vector3());
    };
    const rebuild = (pose: PoseId) => {
        if (model) {
            scene.remove(model);
            model.traverse((item) => {
                if (item instanceof THREE.Mesh) item.geometry.dispose();
            });
        }
        const preset = PRESETS[pose];
        const p: Skeleton = { ...BASE, ...preset.joints };
        const group = new THREE.Group();
        const hipY = (p.hipL[1] + p.hipR[1]) / 2;
        const torso = loft(group, [
            [0.15, -0.14, 0.1], [0.22, -0.07, 0.14], [0.25, 0.05, 0.16],
            [0.22, 0.2, 0.15], [0.2, 0.34, 0.135], [0.22, 0.48, 0.15],
            [0.27, 0.63, 0.17], [0.3, 0.74, 0.15], [0.23, 0.82, 0.12], [0.065, 0.9, 0.065],
        ], [0, hipY, 0]);
        torso.rotation.y = preset.torsoYaw || 0;
        limb(group, [[0, hipY + 0.84, 0], p.neck, [0, p.head[1] - 0.12, 0]], [[0, 0.075], [0.5, 0.068], [1, 0.055]]);
        const head = new THREE.Group();
        head.position.copy(point(p.head));
        head.rotation.y = preset.headYaw || 0;
        loft(head, [
            [0.04, -0.16, 0.05], [0.095, -0.13, 0.1], [0.125, -0.07, 0.125],
            [0.14, 0.02, 0.14], [0.125, 0.11, 0.125], [0.08, 0.16, 0.09], [0.015, 0.18, 0.025],
        ], [0, 0, 0]);
        group.add(head);
        (['L', 'R'] as const).forEach((side) => {
            const shoulder = p[side === 'L' ? 'shoulderL' : 'shoulderR'];
            const elbow = p[side === 'L' ? 'elbowL' : 'elbowR'];
            const wrist = p[side === 'L' ? 'wristL' : 'wristR'];
            const hip = p[side === 'L' ? 'hipL' : 'hipR'];
            const knee = p[side === 'L' ? 'kneeL' : 'kneeR'];
            const ankle = p[side === 'L' ? 'ankleL' : 'ankleR'];
            const toe = p[side === 'L' ? 'toeL' : 'toeR'];
            const armRoot: Point = [shoulder[0] * 0.55, shoulder[1] + 0.03, shoulder[2]];
            limb(group, [armRoot, shoulder, elbow, wrist], [[0, 0.03], [0.3, 0.082], [0.42, 0.08], [0.66, 0.055], [0.8, 0.052], [1, 0.036]]);
            const handDirection = point(wrist).sub(point(elbow)).normalize();
            const hand = ellipse(group, point(wrist).addScaledVector(handDirection, 0.045).toArray() as Point, [0.042, 0.075, 0.028]);
            hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), handDirection);
            const legRoot: Point = [hip[0] * 0.55, hip[1] + 0.14, hip[2]];
            const thigh = pose === 'sit' ? 0.1 : 0.115;
            limb(group, [legRoot, hip, knee, ankle], [[0, 0.035], [0.3, thigh], [0.47, thigh], [0.67, 0.075], [0.82, 0.085], [1, 0.048]]);
            const foot = ellipse(group, point(ankle).lerp(point(toe), 0.55).toArray() as Point, [0.07, 0.048, 0.14]);
            foot.rotation.y = Math.atan2(toe[0] - ankle[0], toe[2] - ankle[2]);
        });
        scene.add(group);
        model = group;
    };
    const render = () => {
        const seated = settings.pose === 'sit';
        const targetY = seated
            ? settings.framing === 'full' ? 0.82 : settings.framing === 'half' ? 1.08 : 1.37
            : settings.framing === 'full' ? 1.2 : settings.framing === 'half' ? 1.72 : 1.98;
        const distance = seated
            ? settings.framing === 'full' ? 3.55 : settings.framing === 'half' ? 2.45 : 1.65
            : settings.framing === 'full' ? 5 : settings.framing === 'half' ? 3.05 : 1.85;
        const yaw = settings.yaw * Math.PI / 180;
        const pitch = Math.max(-89.9, Math.min(89.9, settings.pitch)) * Math.PI / 180;
        camera.aspect = width / height;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, targetY + Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
        camera.lookAt(0, targetY, 0);
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    };
    const resize = (nextWidth: number, nextHeight: number) => {
        width = Math.max(1, Math.round(nextWidth));
        height = Math.max(1, Math.round(nextHeight));
        renderer.setSize(width, height, false);
        render();
    };
    rebuild(initial.pose);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    resize(width, height);

    return {
        canvas: renderer.domElement,
        resize,
        update(next: StageSettings) {
            if (settings.pose !== next.pose) rebuild(next.pose);
            settings = next;
            render();
        },
        capture() {
            const ratio = renderer.getPixelRatio();
            const previous = { width, height };
            renderer.setPixelRatio(1);
            resize(768, 1024);
            const image = renderer.domElement.toDataURL('image/png');
            renderer.setPixelRatio(ratio);
            resize(previous.width, previous.height);
            return image;
        },
        dispose() {
            model?.traverse((item) => {
                if (item instanceof THREE.Mesh) item.geometry.dispose();
            });
            floor.geometry.dispose();
            (floor.material as THREE.Material).dispose();
            body.dispose();
            renderer.dispose();
        },
    };
}
