"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial, Sparkles } from "@react-three/drei";
import * as THREE from "three";

function CoreSphere() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    mesh.current.rotation.y += delta * 0.15;
    mesh.current.rotation.x += delta * 0.05;
  });
  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={1.1}>
      <mesh ref={mesh}>
        <icosahedronGeometry args={[1.45, 24]} />
        <MeshDistortMaterial
          color="#10b981"
          emissive="#022c22"
          roughness={0.18}
          metalness={0.8}
          distort={0.32}
          speed={1.6}
        />
      </mesh>
    </Float>
  );
}

function WireShell() {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (mesh.current) mesh.current.rotation.y -= delta * 0.06;
  });
  return (
    <mesh ref={mesh} scale={2.15}>
      <icosahedronGeometry args={[1, 1]} />
      <meshBasicMaterial color="#34d399" wireframe transparent opacity={0.14} />
    </mesh>
  );
}

export default function HeroCanvas() {
  return (
    <Canvas
      camera={{ position: [0, 0, 5], fov: 45 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true }}
      aria-hidden
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[4, 6, 3]} intensity={1.4} color="#a7f3d0" />
      <pointLight position={[-4, -2, -3]} intensity={1.1} color="#2dd4bf" />
      <CoreSphere />
      <WireShell />
      <Sparkles count={90} scale={7} size={2} speed={0.35} color="#6ee7b7" />
    </Canvas>
  );
}
