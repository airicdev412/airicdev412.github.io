import * as THREE from './vendor/three.module.min.js';
import { createCloudMaterial } from './clouds.js';
import { createRocket, createExhaust } from './rocket.js';

const canvas = document.querySelector('#flight');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const motionButton = document.querySelector('.motion-toggle');
const caption = document.querySelector('.scene-caption');
const kicker = document.querySelector('.caption-kicker');
const title = document.querySelector('.caption-title');
const nav = [...document.querySelectorAll('.chapter-nav a')];
const chapterNumber = document.querySelector('#chapter-number');
const scrollCue = document.querySelector('.scroll-cue');
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a),0,1); return t*t*(3-2*t); };
let paused = motionQuery.matches;
let reduced = motionQuery.matches;
let renderer, frame = 0, failed = false;
let requestRender = () => {};

function updateMotionButton() {
  motionButton.setAttribute('aria-pressed',String(paused));
  motionButton.setAttribute('aria-label',paused ? 'Resume ambient animation' : 'Pause ambient animation');
  document.querySelector('.motion-label').textContent=paused ? 'Resume motion' : 'Pause motion';
  document.body.classList.toggle('is-paused',paused);
}
motionButton.addEventListener('click',()=>{paused=!paused; updateMotionButton(); requestRender();});
motionQuery.addEventListener('change',()=>{reduced=motionQuery.matches; paused=reduced; updateMotionButton(); requestRender();});
updateMotionButton();

function fallback(error) {
  failed=true;
  cancelAnimationFrame(frame); frame=0;
  document.body.classList.remove('is-ready');
  document.body.classList.add('is-fallback');
  motionButton.hidden=true;
  if (!document.querySelector('.fallback-message')) {
    const note=document.createElement('p'); note.className='fallback-message';
    note.textContent='A flight from the clouds to the unknown. The interactive view is unavailable in this browser.';
    document.body.append(note);
  }
  if(error) console.warn('Flight renderer unavailable:',error);
}

try {
  renderer = new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.autoClear=false;
  renderer.setClearColor(0x030507,1);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.25;
  renderer.debug.onShaderError=()=>fallback(new Error('A flight shader could not compile.'));
  initialize();
} catch(error) { fallback(error); }

function initialize() {
  const camera=new THREE.PerspectiveCamera(46,1,.1,1200);
  const scene=new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xf5faff,0x718a9b,3));
  const sun=new THREE.DirectionalLight(0xfff4e5,4.3); sun.position.set(-12,25,18); scene.add(sun);
  const rim=new THREE.DirectionalLight(0x98d9ff,2.2); rim.position.set(8,0,-10); scene.add(rim);
  const rocket=createRocket(); scene.add(rocket.rig);
  const exhaust=createExhaust(innerWidth<600 ? 300 : 420); scene.add(exhaust.points);
  const cloudMaterial=createCloudMaterial();
  const quadCamera=new THREE.Camera();
  const cloudScene=new THREE.Scene();
  const quadGeometry=new THREE.PlaneGeometry(2,2);
  cloudScene.add(new THREE.Mesh(quadGeometry,cloudMaterial));
  const cloudTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  const frontTarget=new THREE.WebGLRenderTarget(1,1,{depthBuffer:false});
  function copyScene(texture,transparent=false) {
    const s=new THREE.Scene();
    s.add(new THREE.Mesh(quadGeometry,new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,transparent,
      uniforms:{uTexture:{value:texture},uSize:cloudMaterial.uniforms.uResolution},
      vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec2 uSize;
        vec4 tap(vec2 offset) {
          vec4 color = texture2D(uTexture, vUv + offset / uSize);
          return vec4(color.rgb * color.a, color.a);
        }
        void main() {
          // Reconstruct the volume with a small tent filter; the rocket stays full-resolution.
          vec4 color = tap(vec2(0.)) * .25;
          color += (tap(vec2(1.,0.)) + tap(vec2(-1.,0.)) + tap(vec2(0.,1.)) + tap(vec2(0.,-1.))) * .125;
          color += (tap(vec2(1.,1.)) + tap(vec2(-1.,1.)) + tap(vec2(1.,-1.)) + tap(vec2(-1.,-1.))) * .0625;
          gl_FragColor = vec4(color.rgb / max(.0001,color.a), color.a);
        }`,
    })));
    return s;
  }
  const backgroundScene=copyScene(cloudTarget.texture);
  const foregroundScene=copyScene(frontTarget.texture,true);
  let width=1,height=1,mastheadHeight=110,maxScroll=1,targetProgress=0,progress=0,time=0,last=0,lastCloud=-1;
  let resolutionScale=1,slowFrames=0,qualitySamples=0,qualityTotal=0;
  let currentChapter=-1;
  let dirty=true;
  const lookAt=new THREE.Vector3();
  const direction=new THREE.Vector3();
  const up=new THREE.Vector3(0,1,0);
  const nozzle=new THREE.Vector3();
  const trailSide=new THREE.Vector3();
  const rocketScreen=new THREE.Vector3();
  const states=[
    {p:0, camera:[0,15,44],target:[0,18,-30],rocket:[-4,4,0],tilt:.22},
    {p:.12,camera:[-1,14,35],target:[-2,16,-15],rocket:[-4,6,0],tilt:.24},
    {p:.25,camera:[-1,15,21],target:[-1,13,0],rocket:[-2.8,10,0],tilt:.28},
    {p:.38,camera:[.5,20,10],target:[0,18,0],rocket:[0,18,0],tilt:.34},
    {p:.54,camera:[4,28,12],target:[4,25,0],rocket:[4,25,0],tilt:.42},
    {p:.80,camera:[0,100,245],target:[0,25,-30],rocket:[48,104,0],tilt:.36},
    {p:1,camera:[0,100,245],target:[0,25,-30],rocket:[48,104,0],tilt:.36},
  ];
  function sizeTargets() {
    // Cloud pixels are budgeted separately so the rocket stays crisp on retina screens.
    const scale=Math.min(.85,Math.sqrt(320000/(width*height)))*resolutionScale;
    cloudTarget.setSize(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
    frontTarget.setSize(cloudTarget.width,cloudTarget.height);
    cloudMaterial.uniforms.uResolution.value.set(cloudTarget.width,cloudTarget.height);
    dirty=true;
  }
  function resize() {
    width=innerWidth; height=innerHeight;
    mastheadHeight=document.querySelector('.masthead').getBoundingClientRect().height;
    cloudMaterial.uniforms.uSkyBand.value.set(mastheadHeight/height,clamp(height*.18,100,180)/height);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.6));
    renderer.setSize(width,height,false);
    camera.aspect=width/height; camera.fov=width<600 ? 57 : 46; camera.updateProjectionMatrix();
    exhaust.material.uniforms.uPixelRatio.value=renderer.getPixelRatio();
    maxScroll=Math.max(1,document.documentElement.scrollHeight-height);
    sizeTargets(); onScroll();
  }
  function onScroll() {
    targetProgress=clamp(scrollY/maxScroll,0,1);
    dirty=true; requestRender();
  }
  function setVector(vector,a,b,t) { vector.set(lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)); }
  function pose(p) {
    let index=0;
    while(index<states.length-2 && p>states[index+1].p) index++;
    const a=states[index],b=states[index+1];
    const t=smooth(a.p,b.p,p);
    setVector(camera.position,a.camera,b.camera,t);
    setVector(lookAt,a.target,b.target,t);
    setVector(rocket.rig.position,a.rocket,b.rocket,t);
    camera.lookAt(lookAt); camera.updateMatrixWorld();
    const panorama=smooth(.54,.80,p);
    const framing=smooth(.54,.68,p);
    // A small subject above a long diagonal plume, as in clouds3.jpg.
    rocketScreen.copy(rocket.rig.position).project(camera);
    rocketScreen.x=lerp(rocketScreen.x,width<600 ? .48 : .36,framing);
    // Keep the wide-view rocket below the shared header band on short screens too.
    rocketScreen.y=lerp(rocketScreen.y,1-2*Math.max(.12,(mastheadHeight+24)/height),framing);
    rocket.rig.position.copy(rocketScreen.unproject(camera));
    const rocketScale=lerp(1,.85,panorama);
    rocket.rig.scale.setScalar(rocketScale);
    const tilt=lerp(a.tilt,b.tilt,t);
    direction.set(Math.sin(tilt),Math.cos(tilt),-.08).normalize();
    rocket.rig.quaternion.setFromUnitVectors(up,direction);
    rocket.model.rotation.y=.14+Math.sin(time*.3)*.07;
    rocket.rig.visible=p>.15;
    rocket.flameMaterial.uniforms.uTime.value=time;
    const pulse=1+Math.sin(time*28)*.035;
    rocket.flame.scale.y=rocket.flameCross.scale.y=pulse;
    rocket.engineLight.intensity=7*pulse;
    nozzle.copy(rocket.rig.position).addScaledVector(direction,-1.7*rocketScale);
    trailSide.set(direction.y,-direction.x,0);
    exhaust.points.visible=rocket.rig.visible;
    const spread=lerp(.8,2.8,panorama);
    const length=lerp(12,300,panorama);
    exhaust.material.uniforms.uPanorama.value=panorama;
    exhaust.material.uniforms.uPointScale.value=lerp(280,height/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5)),panorama);
    for(let i=0;i<exhaust.count;i++) {
      // The wide plume stays attached to the flight path; only its billows drift.
      const phase=(i/exhaust.count+time*lerp(.13,.012,panorama))%1;
      const age=Math.pow(phase,lerp(1,1.4,panorama));
      const jitter=Math.sin(i*127.1), jitter2=Math.cos(i*311.7);
      const distance=age*length;
      const radius=(.12+age*age*spread);
      const x=nozzle.x-direction.x*distance+trailSide.x*jitter*radius;
      const y=nozzle.y-direction.y*distance+trailSide.y*jitter*radius;
      const z=nozzle.z-direction.z*distance+jitter2*radius;
      exhaust.positions[i*3]=x; exhaust.positions[i*3+1]=y; exhaust.positions[i*3+2]=z;
      exhaust.sizes[i]=lerp((.08+age*2.2)*spread,(1.1+Math.pow(age,.65)*9)*(1+jitter*.18),panorama);
      exhaust.alphas[i]=lerp((1-age)*.3*smooth(0,.08,age),.85*smooth(0,.015,age)*(1-smooth(.82,1,age)),panorama);
    }
    exhaust.points.geometry.attributes.position.needsUpdate=true;
    exhaust.points.geometry.attributes.aSize.needsUpdate=true;
    exhaust.points.geometry.attributes.aAlpha.needsUpdate=true;
    const uniforms=cloudMaterial.uniforms;
    uniforms.uTime.value=time;
    // The burst follows the camera timeline in both scroll directions.
    uniforms.uBurst.value=p >= .21 && p < .39 ? (p-.21)/.18 : -1;
    uniforms.uPanorama.value=panorama;
    uniforms.uEarthRadius.value=lerp(1400,12000,panorama);
    uniforms.uCamera.value.copy(camera.position);
    uniforms.uCameraMatrix.value.copy(camera.matrixWorld);
    uniforms.uAspect.value=camera.aspect;
    uniforms.uTanFov.value=Math.tan(THREE.MathUtils.degToRad(camera.fov)*.5);
    uniforms.uCutoff.value=camera.position.distanceTo(rocket.rig.position)-.6*rocketScale;
  }
  function updateUI(p) {
    const chapter=p<.29 ? 0 : p<.68 ? 1 : 2;
    if(chapter!==currentChapter) {
      currentChapter=chapter;
      document.body.dataset.chapter=String(chapter);
      nav.forEach((a,i)=>{if(i===chapter)a.setAttribute('aria-current','step');else a.removeAttribute('aria-current');});
      const names=['ABOVE THE CLOUDS','BREAK THROUGH','THE ASCENT'];
      const titles=['Beyond the clouds.','A little closer.','Into the unknown.'];
      kicker.textContent=`0${chapter+1} / ${names[chapter]}`;
      title.textContent=titles[chapter]; chapterNumber.textContent=`0${chapter+1}`;
      scrollCue.href=chapter===2 ? '#overview' : chapter===1 ? '#ascent' : '#ignition';
      document.querySelector('.scroll-label').textContent=chapter===2 ? 'Back to the clouds' : 'Scroll to ascend';
      scrollCue.lastElementChild.textContent=chapter===2 ? '↑' : '↓';
    }
    // Leave the close-up free of competing copy for most of the middle hold.
    const opacity=chapter===0 ? 1-smooth(.09,.24,p) : chapter===1 ? smooth(.29,.36,p)*(1-smooth(.45,.56,p)) : smooth(.68,.76,p);
    caption.style.opacity=String(opacity);
    caption.style.transform=`translateY(${(1-opacity)*-12}px)`;
  }
  function render(now) {
    frame=0;
    if(document.hidden||failed)return;
    const elapsed=last ? Math.min((now-last)/1000,.1) : .016;
    last=now;
    const previous=progress;
    if(reduced) {
      progress=targetProgress<.25 ? 0 : targetProgress<.75 ? .5 : 1;
    } else progress=lerp(progress,targetProgress,1-Math.exp(-elapsed*9));
    if(Math.abs(progress-targetProgress)<.00005&&!reduced) progress=targetProgress;
    if(!paused) time+=elapsed;
    pose(progress); updateUI(progress);
    const moving=Math.abs(progress-previous)>.00001;
    const foreground=progress>.15&&progress<.38;
    // At rest the drifting cloud volume runs at 24 fps, while the mesh stays smooth.
    if(dirty||moving||now-lastCloud>1000/24) {
      cloudMaterial.uniforms.uForeground.value=false;
      renderer.setRenderTarget(cloudTarget); renderer.clear(); renderer.render(cloudScene,quadCamera);
      if(foreground) {
        cloudMaterial.uniforms.uForeground.value=true;
        renderer.setRenderTarget(frontTarget); renderer.clear(); renderer.render(cloudScene,quadCamera);
      }
      lastCloud=now; dirty=false;
    }
    renderer.setRenderTarget(null); renderer.clear();
    renderer.render(backgroundScene,quadCamera);
    renderer.clearDepth(); renderer.render(scene,camera);
    if(foreground) renderer.render(foregroundScene,quadCamera);
    if(!document.body.classList.contains('is-ready')&&!failed)document.body.classList.add('is-ready');
    // Lower volume resolution after sustained frame pressure, never above the initial budget.
    if(!paused && !reduced && qualitySamples<180) {
      qualitySamples++; qualityTotal+=elapsed;
      if(qualitySamples===60) {
        if(qualityTotal/qualitySamples>.035&&resolutionScale>.55) {resolutionScale*=.78; sizeTargets(); slowFrames++;}
        if(slowFrames<2){qualitySamples=0;qualityTotal=0;}
      }
    }
    if(!paused||(!reduced&&Math.abs(progress-targetProgress)>.00005))requestRender();
  }
  requestRender=()=>{if(!frame&&!document.hidden&&!failed) frame=requestAnimationFrame(render);};
  addEventListener('scroll',onScroll,{passive:true});
  addEventListener('resize',resize,{passive:true});
  motionQuery.addEventListener('change',resize);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{last=0;dirty=true;requestRender();}
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();});
  canvas.addEventListener('webglcontextrestored',()=>{failed=false;document.body.classList.remove('is-fallback');document.querySelector('.fallback-message')?.remove();motionButton.hidden=false;resize();});
  resize();progress=targetProgress;requestRender();
}
