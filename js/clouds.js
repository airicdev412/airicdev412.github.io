// Procedural cloud volume: the pullback opens onto a broad daylight horizon.
// Noise is sampled from a tiny repeating texture; no cloud image downloads.
import * as THREE from './vendor/three.module.min.js';

export function createCloudMaterial() {
  let seed = 71237;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const size = 256;
  const values = Uint8Array.from({ length: size * size }, () => random() * 255);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    data[i] = values[y * size + x];
    data[i + 1] = values[((y + 17) % size) * size + (x + 37) % size];
    data[i + 2] = 0; data[i + 3] = 255;
  }
  const noise = new THREE.DataTexture(data, size, size);
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  noise.minFilter = noise.magFilter = THREE.LinearFilter;
  noise.needsUpdate = true;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false, depthWrite: false,
    uniforms: {
      uNoise: { value: noise }, uTime: { value: 0 },
      uCloudAtlas: { value: null },
      uCamera: { value: new THREE.Vector3() },
      uCameraMatrix: { value: new THREE.Matrix4() },
      uAspect: { value: 1 }, uTanFov: { value: .45 },
      uResolution: { value: new THREE.Vector2() },
      uSkyBand: { value: new THREE.Vector2(.14, .18) },
      uForeground: { value: false }, uCutoff: { value: 1000 },
      uBurst: { value: -1 },
      uPanorama: { value: 0 }, uEarthRadius: { value: 1400 },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      layout(location = 0) out vec4 backgroundColor;
      layout(location = 1) out vec4 foregroundColor;
      uniform sampler2D uNoise, uCloudAtlas;
      uniform float uTime, uAspect, uTanFov, uCutoff, uBurst, uPanorama, uEarthRadius;
      uniform vec2 uResolution, uSkyBand;
      uniform vec3 uCamera;
      uniform mat4 uCameraMatrix;
      uniform bool uForeground;
      #define CENTER vec3(0., -uEarthRadius, 0.)
      const vec3 SUN = vec3(-.72, .62, .30);
      float noise3(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        vec2 uv = i.xy + vec2(37., 17.) * i.z + f.xy;
        vec2 rg = texture2D(uNoise, (uv + .5) / 256.).rg;
        return mix(rg.x, rg.y, f.z);
      }
      float fbm(vec3 p) {
        float f = .53 * noise3(p);
        p = p * 2.03 + 19.1; f += .27 * noise3(p);
        p = p * 2.02 + 7.7; f += .13 * noise3(p);
        return f + .07 * noise3(p * 2.01);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float softUnion(float a, float b, float k) {
        float h = max(k - abs(a - b), 0.) / k;
        return min(a, b) - h * h * k * .25;
      }
      // Overlapping lobes give the banks tall, irregular cumulus silhouettes.
      // Turbulence below breaks their surfaces into smaller sunlit billows.
      float puffShape(vec3 q) {
        float d = length(q / vec3(8.2, 3.8, 7.)) - 1.;
        d = softUnion(d, length((q - vec3(-3.2, 2.7, .3)) / vec3(4.8, 5.9, 4.7)) - 1., .28);
        d = softUnion(d, length((q - vec3(3.8, 1.6, -.8)) / vec3(4.9, 4.6, 5.3)) - 1., .28);
        d = softUnion(d, length((q - vec3(.2, 5., -1.)) / vec3(3.5, 4.3, 3.7)) - 1., .25);
        return d;
      }
      vec3 puffNormal(vec3 q) {
        vec3 a = q / vec3(8.2, 3.8, 7.);
        vec3 b = (q - vec3(-3.2, 2.7, .3)) / vec3(4.8, 5.9, 4.7);
        vec3 c = (q - vec3(3.8, 1.6, -.8)) / vec3(4.9, 4.6, 5.3);
        vec3 e = (q - vec3(.2, 5., -1.)) / vec3(3.5, 4.3, 3.7);
        vec4 weights = exp(-vec4(length(a), length(b), length(c), length(e)) * 8.);
        return normalize(a / vec3(8.2, 3.8, 7.) * weights.x +
          b / vec3(4.8, 5.9, 4.7) * weights.y + c / vec3(4.9, 4.6, 5.3) * weights.z +
          e / vec3(3.5, 4.3, 3.7) * weights.w);
      }
      float density(vec3 p, out vec3 normal) {
        normal = vec3(0., 1., 0.);
        float h = length(p - CENTER) - uEarthRadius;
        if (h < .8 || h > 32.) return 0.;
        vec2 drift = vec2(uTime * .085, uTime * .035);
        vec2 plane = (p.xz + drift) * mix(vec2(1.), vec2(.65), uPanorama);
        // Broad domain warping breaks up regular rows without adding wispy noise.
        plane += (vec2(noise3(vec3(plane * .018, 3.)), noise3(vec3(plane * .018, 17.))) - .5) * 24.;
        vec2 baseCell = floor(plane / 24. - .5);
        float distanceFade = smoothstep(70., 240., length(p.xz));
        float weather = noise3(vec3(plane.x * .009, 4.3, plane.y * .009));
        float weatherCoverage = smoothstep(mix(.08, .32, distanceFade), mix(.23, .52, distanceFade), weather);
        // Overlapping banks leave only small openings in the panorama cloud sea.
        weatherCoverage = mix(weatherCoverage, mix(.7, 1., smoothstep(.22, .46, weather)), uPanorama);
        // Broader, quieter surface detail lets the panorama's large lobes read clearly.
        float detail = fbm(p * mix(.55, .18, uPanorama));
        vec3 noisePoint = p * mix(.23, .10, uPanorama);
        vec3 turbulence = vec3(noise3(noisePoint), noise3(noisePoint + 31.), noise3(noisePoint + 67.)) - .5;
        float warpStrength = mix(1.7, .9, uPanorama);
        float detailStrength = mix(.48, .18, uPanorama);
        // Retain a connected lower deck beneath the taller panorama billows.
        float deck = (1. - smoothstep(3., mix(6.5, 8., uPanorama), h + detail * 2.)) * weatherCoverage * .8;
        // Check neighboring centers so clusters can be irregularly spaced without
        // clipping at tile boundaries or lining up into visible rows.
        for (int cx = 0; cx < 2; cx++) for (int cz = 0; cz < 2; cz++) {
          vec2 cell = baseCell + vec2(float(cx), float(cz));
          float seed = hash(cell + 19.);
          vec2 center = (cell + .5) * 24. + (vec2(seed, hash(cell + 4.)) - .5) * 6.;
          vec2 local = plane - center;
          float angle = seed * 6.283;
          local = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * local;
          float scale = mix(.85, 1.5, hash(cell + 7.));
          float cloudHeight = 4. + hash(cell + 27.) * 3.;
          vec3 puffScale = mix(vec3(1.), vec3(1.1, 1.35, 1.1), uPanorama);
          vec3 q = vec3(local.x, h - cloudHeight, local.y) / (scale * puffScale) + turbulence * warpStrength;
          float shape = puffShape(q) + (detail - .48) * detailStrength;
          float coverage = weatherCoverage * smoothstep(mix(.0, .22, distanceFade * (1. - uPanorama)), mix(.06, .43, distanceFade * (1. - uPanorama)), seed);
          float candidate = (1. - smoothstep(-.10, .055, shape)) * coverage * 1.35;
          if (candidate > deck) {
            deck = candidate;
            normal = normalize(puffNormal(q) / puffScale);
            normal.xz = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * normal.xz;
          }
        }
        // A permanent launch cloud anchors the disturbance to the rocket's path.
        vec3 origin = vec3(-2.8, 5.2, 0.);
        vec3 launchPoint = vec3(p.x-origin.x,h-origin.y,p.z) + turbulence * warpStrength;
        float launch = (1. - smoothstep(-.10, .055, puffShape(launchPoint) + (detail - .48) * detailStrength)) * 1.35;
        if (launch > deck) normal = puffNormal(launchPoint);
        deck = max(deck, launch);
        float burst = 0.;
        vec3 burstNormal = normal;
        if (uBurst >= 0. && uBurst < 1.) {
          float age = uBurst;
          float fade = smoothstep(0., .09, age) * (1. - smoothstep(.35, .9, age));
          vec3 v = vec3(p.x - origin.x, h - origin.y, p.z);
          v.y -= 7.;
          float azimuth = atan(v.z, v.x);
          float radius = .8 + 7.2 * (1. - pow(1. - age, 2.));
          float lobes = sin(azimuth * 10.) * .28;
          float ring = length(vec2(length(v.xz) - radius, (v.y - 1.5 * age) * 1.15));
          burstNormal = normalize(vec3(normalize(v.xz + .0001) * (length(v.xz) - radius), v.y - 1.5 * age)).xzy;
          burst = (1. - smoothstep(.65 + age * .55 + lobes, 1.25 + age * .55 + lobes, ring)) * fade;
          // Three billows shoot upward and outward from the pressure ring.
          for (int j = 0; j < 3; j++) {
            float a = float(j) * 2.094 + .4;
            vec3 center = vec3(cos(a) * age * 7., 1. + age * 5., sin(a) * age * 7.);
            float puff = length((v - center) / vec3(1.1 + age * .45, 1.3 + age * .8, 1.1 + age * .45));
            float billow = (1. - smoothstep(.65, 1.1, puff)) * fade;
            if (billow > burst) burstNormal = normalize(v - center);
            burst = max(burst, billow);
          }
          float opening = 1. - smoothstep(.8, 2.8 + age * 1.6, length(v.xz));
          deck *= 1. - opening * fade * .9;
        }
        if (burst * 1.8 > deck) normal = burstNormal;
        return max(deck, burst * 1.8);
      }
      vec2 sphere(vec3 ro, vec3 rd, float radius) {
        vec3 oc = ro - CENTER;
        float b = dot(oc, rd), c = dot(oc, oc) - radius * radius;
        float d = b * b - c;
        if (d < 0.) return vec2(-1.);
        float s = sqrt(d);
        return vec2(-b - s, -b + s);
      }
      // Four fixed world-space rows of cloud cards, sampled back to front.
      // Each card uses a one-time bake of the same rounded, lit cloud lobes.
      vec3 distantClouds(vec3 col, vec3 ro, vec3 rd) {
        if (uPanorama <= 0. || rd.z >= -.01) return col;
        for (int row = 3; row >= 0; row--) {
          float layer = float(row);
          float z = row == 0 ? -25. : row == 1 ? -280. : row == 2 ? -750. : -1600.;
          float t = (z - ro.z) / rd.z;
          if (t <= 0.) continue;
          vec3 p = ro + rd * t;
          float spacing = 42. + layer * 8.;
          float drift = uTime * .085;
          float cell = floor((p.x + drift) / spacing);
          // Overlap neighboring cards so the banks do not read as isolated stamps.
          for (int neighbor = 0; neighbor < 2; neighbor++) {
            float id = cell + float(neighbor);
            float seed = hash(vec2(id, layer + 51.));
            float center = id * spacing + (seed - .5) * spacing * .3;
            float height = 44. * mix(.85, 1.25, seed);
            float base = 5. - height * .3 - (z * z + center * center) / (2. * uEarthRadius);
            // Keep each card within its two-cell neighborhood, including jitter.
            float width = min(height * 1.8, spacing * 1.65);
            vec2 uv = vec2((p.x + drift - center) / width + .5, (p.y - base) / height);
            if (uv.x <= 0. || uv.x >= 1. || uv.y <= 0. || uv.y >= 1.) continue;
            float variant = floor(seed * 4.);
            vec4 card = texture2D(uCloudAtlas, vec2((uv.x + variant) * .25, uv.y));
            float haze = 1. - exp(-t * .0025);
            vec3 shade = mix(card.rgb, vec3(.36,.54,.72), haze * .82);
            float opacity = card.a * smoothstep(.12, .32, uv.y) * smoothstep(180., 280., t) * uPanorama;
            col = mix(col, shade, opacity);
          }
        }
        return col;
      }
      vec3 background(vec3 ro, vec3 rd) {
        float radius = length(ro - CENTER);
        float horizon = dot(normalize(ro - CENTER), rd) + sqrt(max(0., 1. - pow((uEarthRadius + 16.) / radius, 2.)));
        float skyHeight = smoothstep(-.12, .43, rd.y);
        vec3 daylight = mix(vec3(.055, .27, .60), vec3(.0015, .003, .028), skyHeight);
        vec3 wideSky = mix(vec3(.24,.39,.56), vec3(.16,.46,.72), smoothstep(0., .10, horizon));
        wideSky += vec3(.035,.03,.025) * exp(-abs(horizon) * 38.);
        vec3 col = mix(daylight, wideSky, uPanorama);
        vec2 hit = sphere(ro, rd, uEarthRadius);
        if (hit.x > 0.) {
          vec3 p = ro + rd * hit.x;
          float terrain = fbm(vec3(p.x * .009, 8., p.z * .009));
          vec3 ocean = mix(vec3(.008,.045,.12), vec3(.025,.16,.25), terrain);
          float haze = 1. - exp(-hit.x * .002);
          col = mix(ocean, vec3(.30,.53,.68), haze * .55);
          col = mix(col, mix(vec3(.08,.26,.48),vec3(.38,.52,.66),1.-exp(-hit.x*.0012)),uPanorama);
        }
        // A cheap distant cloud sheet carries fine weather layers to the horizon;
        // the ray-marched banks below supply the nearby three-dimensional billows.
        vec2 sheet = sphere(ro, rd, uEarthRadius + 5.);
        if (sheet.x > 0. && uPanorama > 0.) {
          vec3 p = ro + rd * sheet.x;
          vec3 q = vec3(p.x*.009, 12., p.z*.016);
          float weather = fbm(q);
          // A connected deck keeps the distant cards seated in cloud cover.
          float coverage = mix(.88, 1., smoothstep(.30,.48,weather));
          float detail = noise3(q*4. + 21.);
          vec3 white = mix(vec3(.44,.60,.74),vec3(.91,.94,.95),smoothstep(.42,.70,weather) * .65 + detail*.25);
          white = mix(white,vec3(.43,.57,.70),1.-exp(-sheet.x*.0007));
          col = mix(col,white,coverage*uPanorama);
        }
        return distantClouds(col, ro, rd);
      }
      void main() {
        float skyFade = smoothstep(uSkyBand.x, uSkyBand.x + uSkyBand.y, 1. - vUv.y);
        foregroundColor = vec4(0.);
        // The opaque upper sky band hides all scene detail here.
        if (skyFade == 0.) {
          backgroundColor = vec4(vec3(3., 5., 7.) / 255., 1.);
          return;
        }
        vec2 xy = (vUv * 2. - 1.) * vec2(uAspect, 1.) * uTanFov;
        vec3 rd = normalize((uCameraMatrix * vec4(xy, -1., 0.)).xyz);
        vec3 base = background(uCamera, rd);
        vec2 outer = sphere(uCamera, rd, uEarthRadius + 32.);
        vec4 cloud = vec4(0.);
        vec4 front = vec4(0.);
        if (outer.y > 0.) {
          float start = max(0., outer.x);
          // Distant rays skip density and lighting probes entirely in the panorama.
          float end = min(outer.y, mix(1100., 320., uPanorama));
          vec2 inner = sphere(uCamera, rd, uEarthRadius + .8);
          if (inner.x > 0.) end = min(end, inner.x);
          // Smaller panorama steps resolve smooth lobe edges without noisy coverage.
          float stepRate = mix(.012, .008, uPanorama);
          float t = start + hash(gl_FragCoord.xy) * max(.18, start * stepRate);
          for (int i = 0; i < 112; i++) {
            if (t > end || cloud.a > .985) break;
            float stepSize = max(.18, t * stepRate);
            vec3 p = uCamera + rd * t;
            vec3 normal;
            float d = density(p, normal);
            d *= 1. - uPanorama * smoothstep(220., 320., t);
            if (d > .002) {
              // One sunward density probe shades the small billows as well as the
              // large lobes, with blue skylight retained inside the shadows.
              float light = smoothstep(-.55, .85, dot(normal, SUN));
              float h = length(p - CENTER) - uEarthRadius;
              vec3 unusedNormal;
              float shadow = density(p + SUN * 2.2, unusedNormal);
              float sunlight = exp(-shadow * 1.4);
              vec3 shade = mix(vec3(.28,.49,.63), vec3(1., 1., .98), light * .38 + sunlight * .62);
              shade += vec3(.045,.055,.06) * smoothstep(3., 16., h);
              float haze = 1. - exp(-t * .0025);
              shade = mix(shade, mix(vec3(.57,.75,.85),vec3(.36,.54,.72),uPanorama), haze * mix(.55,.82,uPanorama));
              float a = 1. - exp(-d * stepSize * 1.35);
              cloud.rgb += (1. - cloud.a) * a * shade;
              cloud.a += (1. - cloud.a) * a;
            }
            // Both layers follow identical rays. Save the accumulated volume
            // in front of the rocket instead of marching the same ray twice.
            if (uForeground && t <= uCutoff) front = cloud;
            // Traverse empty air quickly, then take fine samples inside a bank.
            t += d > .002 ? stepSize : max(.8, t * .012);
          }
        }
        // Screen-space height keeps the black sky at half the masthead height
        // as the camera changes altitude; smoothstep preserves the soft fade.
        if (uForeground) {
          foregroundColor = vec4(pow(max(front.rgb / max(front.a, .001), vec3(0.)), vec3(.4545)), front.a * skyFade);
        }
        vec3 color = cloud.rgb + base * (1. - cloud.a);
        color = pow(max(color, vec3(0.)), vec3(.4545));
        // Subtle lens falloff, with white highlights kept neutral.
        color *= 1. - .09 * pow(length(vUv - .5), 1.4);
        color = mix(vec3(3., 5., 7.) / 255., color, skyFade);
        backgroundColor = vec4(color, 1.);
      }
    `,
  });
}

// Bake four reusable cloud silhouettes once, rather than marching distant
// volumes every frame. The atlas stays on the GPU and needs no image downloads.
export function createCloudAtlas(renderer, cloudMaterial) {
  const target = new THREE.WebGLRenderTarget(768, 192, { depthBuffer: false });
  const prefix = cloudMaterial.fragmentShader.split('      void main() {')[0]
    .replace('layout(location = 1) out vec4 foregroundColor;', '');
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    depthTest: false, depthWrite: false,
    uniforms: { uNoise: cloudMaterial.uniforms.uNoise },
    vertexShader: cloudMaterial.vertexShader,
    fragmentShader: prefix + `
      void main() {
        float variant = floor(vUv.x * 4.);
        vec2 uv = vec2(fract(vUv.x * 4.), vUv.y);
        vec3 ro = vec3((uv.x - .5) * 28., uv.y * 20. - 6., 20.);
        vec4 cloud = vec4(0.);
        for (int i = 0; i < 100; i++) {
          if (cloud.a > .99) break;
          vec3 p = ro - vec3(0., 0., float(i) * .4);
          vec3 noisePoint = p + variant * 31.;
          vec3 turbulence = vec3(noise3(noisePoint * .23), noise3(noisePoint * .23 + 31.), noise3(noisePoint * .23 + 67.)) - .5;
          vec3 q = p + turbulence * 1.7;
          float shape = puffShape(q) + (fbm(noisePoint * .55) - .48) * .48;
          float d = (1. - smoothstep(-.10, .055, shape)) * 1.35;
          if (d < .002) continue;
          float light = smoothstep(-.55, .85, dot(puffNormal(q), SUN));
          float shadow = (1. - smoothstep(-.10, .055, puffShape(q + SUN * 2.2))) * 1.35;
          vec3 shade = mix(vec3(.28,.49,.63), vec3(1.,1.,.98), light * .38 + exp(-shadow * 1.4) * .62);
          shade += vec3(.045,.055,.06) * smoothstep(3.,16.,p.y + 6.);
          float a = 1. - exp(-d * .4 * 1.35);
          cloud.rgb += (1. - cloud.a) * a * shade;
          cloud.a += (1. - cloud.a) * a;
        }
        backgroundColor = vec4(cloud.rgb / max(cloud.a, .001), cloud.a);
      }`,
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.Camera();
  const bake = () => {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  };
  bake();
  cloudMaterial.uniforms.uCloudAtlas.value = target.texture;
  return { bake };
}
