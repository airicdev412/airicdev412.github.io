import * as THREE from './vendor/three.module.min.js';

// Replacement boundary: +Y is forward; keep the engine attachment at y = -1.65.
// Swap the contents of `model` for a GLTF scene without changing the flight rig.
export function createRocket() {
  const rig = new THREE.Group();
  const model = new THREE.Group();
  rig.add(model);
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf0f0e9, metalness: .32, roughness: .28 });
  const graphite = new THREE.MeshStandardMaterial({ color: 0x202a32, metalness: .7, roughness: .26 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xa1b0b7, metalness: .8, roughness: .24 });
  function part(geometry, material, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); model.add(mesh); return mesh;
  }
  const profile = [new THREE.Vector2(0,-1.4), new THREE.Vector2(.34,-1.4), new THREE.Vector2(.44,-1.12), new THREE.Vector2(.44,.65), new THREE.Vector2(.41,1.05), new THREE.Vector2(.31,1.43), new THREE.Vector2(.15,1.78), new THREE.Vector2(0,1.98)];
  part(new THREE.LatheGeometry(profile, 48), ceramic);
  part(new THREE.CylinderGeometry(.447,.447,.17,48), graphite,0,-.76);
  part(new THREE.CylinderGeometry(.422,.435,.05,48), metal,0,.86);
  part(new THREE.CylinderGeometry(.23,.33,.36,32,1,true), graphite,0,-1.52);
  const rim = part(new THREE.TorusGeometry(.18,.045,12,36), metal,0,.64,.411);
  const windowMesh = part(new THREE.SphereGeometry(.145,24,16), new THREE.MeshStandardMaterial({ color: 0x092b3c, metalness: .6, roughness: .12, emissive: 0x153f58, emissiveIntensity: .24 }),0,.64,.433);
  windowMesh.scale.z = .3;
  const finShape = new THREE.Shape();
  finShape.moveTo(.35,-.45); finShape.lineTo(.98,-1.5); finShape.quadraticCurveTo(.99,-1.65,.83,-1.59); finShape.lineTo(.34,-1.15); finShape.closePath();
  const finGeometry = new THREE.ExtrudeGeometry(finShape,{depth:.075,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.025,bevelThickness:.025});
  finGeometry.translate(0,0,-.0375);
  for (let i=0;i<3;i++) { const fin = part(finGeometry,graphite); fin.rotation.y = i*Math.PI*2/3+.3; }
  // Small hull marking, generated locally once.
  const label = document.createElement('canvas'); label.width=256; label.height=128;
  const ctx=label.getContext('2d'); ctx.fillStyle='#edf0ee'; ctx.fillRect(0,0,256,128);
  ctx.fillStyle='#34434b'; ctx.font='bold 42px Arial'; ctx.textAlign='center'; ctx.fillText('AIR',128,70);
  ctx.font='15px Arial'; ctx.fillText('0 1',128,98);
  const texture=new THREE.CanvasTexture(label); texture.colorSpace=THREE.SRGBColorSpace;
  part(new THREE.PlaneGeometry(.39,.195),new THREE.MeshStandardMaterial({map:texture,roughness:.5}),0,-.17,.444);

  const flameMaterial = new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    uniforms:{uTime:{value:0}},
    vertexShader:`varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 vUv; uniform float uTime;
      void main(){
        float t=1.-vUv.y;
        float wave=sin(t*38.-uTime*24.)*.035+sin(t*71.+uTime*31.)*.017;
        float w=(.14+.19*sin(t*3.14))*pow(1.-t,.65);
        float x=abs(vUv.x-.5+wave*t);
        float a=(1.-smoothstep(w*.2,w,x))*(1.-smoothstep(.55,1.,t));
        vec3 color=mix(vec3(.36,.65,1.),vec3(1.,.27,.035),smoothstep(.05,.46,t));
        color=mix(color,vec3(1.,.94,.73),pow(max(0.,1.-x/max(.001,w)),5.));
        gl_FragColor=vec4(color,a*.88);
      }`,
  });
  const flame = new THREE.Mesh(new THREE.PlaneGeometry(1.65,4.8),flameMaterial);
  flame.position.y=-3.99; rig.add(flame);
  const flameCross=flame.clone(); flameCross.rotation.y=Math.PI/2; rig.add(flameCross);
  const engineLight=new THREE.PointLight(0xff9a46,7,8,2); engineLight.position.y=-1.9; rig.add(engineLight);
  return { rig, model, flame, flameCross, flameMaterial, engineLight };
}

export function createExhaust(count = 260) {
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(count*3), sizes=new Float32Array(count), alphas=new Float32Array(count);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aAlpha',new THREE.BufferAttribute(alphas,1).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,
    uniforms:{uPixelRatio:{value:1},uPointScale:{value:280},uPanorama:{value:0}},
    vertexShader:`attribute float aSize; attribute float aAlpha; varying float vAlpha; uniform float uPixelRatio, uPointScale;
      void main(){vAlpha=aAlpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=min(180.,aSize*uPixelRatio*uPointScale/max(1.,-mv.z));}`,
    fragmentShader:`varying float vAlpha; uniform float uPanorama;
      void main(){
        vec2 p=gl_PointCoord-.5;
        float r=length(p)*2.;
        float soft=exp(-r*r*4.)*(1.-smoothstep(.6,1.,r));
        float billow=(1.-smoothstep(.45,1.,r))*(.85+.15*sin(p.x*23.+sin(p.y*19.)));
        float light=clamp(.75-p.x*.3-p.y*.25,0.,1.);
        vec3 smoke=mix(vec3(.66,.78,.85),vec3(1.,.995,.96),light);
        vec3 color=mix(mix(vec3(.83,.89,.94),vec3(1.,.77,.47),vAlpha),smoke,uPanorama);
        gl_FragColor=vec4(color,mix(soft,billow,uPanorama)*vAlpha);
      }`,
  });
  const points=new THREE.Points(geometry,material); points.frustumCulled=false;
  return {points,positions,sizes,alphas,count,material};
}
