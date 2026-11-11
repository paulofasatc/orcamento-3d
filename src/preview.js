import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Pré-visualização 3D de uma malha STL com three.js + OrbitControls.
 */
export class StlPreview {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.mesh = null;
    this.grid = null;
    this.raf = 0;
    this.disposed = false;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161310);

    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    this.camera.position.set(80, 60, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x1a1612, 1.05);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(60, 120, 80);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fd6cf, 0.35);
    fill.position.set(-80, 40, -60);
    this.scene.add(fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /**
   * @param {import("./stl.js").Triangle[]} triangles
   * @param {{x:number,y:number,z:number}} size
   * @param {{x:number,y:number,z:number}} min
   */
  load(triangles, size, min) {
    this.clearMesh();

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(triangles.length * 9);
    let i = 0;
    for (const [a, b, c] of triangles) {
      positions[i++] = a.x;
      positions[i++] = a.z;
      positions[i++] = a.y;
      positions[i++] = b.x;
      positions[i++] = b.z;
      positions[i++] = b.y;
      positions[i++] = c.x;
      positions[i++] = c.z;
      positions[i++] = c.y;
    }
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    // Centraliza no XZ e assenta no chão (Y=0). Y de tela = Z do modelo (STL em mm).
    const cx = min.x + size.x / 2;
    const cy = min.y + size.y / 2;
    geometry.translate(-cx, -min.z, -cy);

    const material = new THREE.MeshStandardMaterial({
      color: 0xe8a87c,
      roughness: 0.45,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    const span = Math.max(size.x, size.y, size.z, 1);
    const gridSize = Math.max(40, Math.ceil(span * 2.2));
    this.grid = new THREE.GridHelper(gridSize, 16, 0x3a332c, 0x2a2520);
    this.grid.position.y = 0;
    this.scene.add(this.grid);

    const dist = span * 1.85;
    this.camera.position.set(dist, dist * 0.75, dist);
    this.camera.near = Math.max(0.01, span / 200);
    this.camera.far = Math.max(1000, span * 40);
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, size.z / 2, 0);
    this.controls.update();
  }

  clear() {
    this.clearMesh();
    this.camera.position.set(80, 60, 100);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  clearMesh() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
      this.grid = null;
    }
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  loop() {
    if (this.disposed) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.loop);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.clearMesh();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
