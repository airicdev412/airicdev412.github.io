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
    depthTest: false, depthWrite: false,
    uniforms: {
      uNoise: { value: noise }, uTime: { value: 0 },
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
      uniform sampler2D uNoise;
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
        vec2 plane = (p.xz + drift) * mix(vec2(1.), vec2(.34,.65), uPanorama);
        // Broad domain warping breaks up regular rows without adding wispy noise.
        plane += (vec2(noise3(vec3(plane * .018, 3.)), noise3(vec3(plane * .018, 17.))) - .5) * 24.;
        vec2 baseCell = floor(plane / 24. - .5);
        float distanceFade = smoothstep(70., 240., length(p.xz));
        float weather = noise3(vec3(plane.x * .009, 4.3, plane.y * .009));
        float weatherCoverage = smoothstep(mix(.08, .32, distanceFade), mix(.23, .52, distanceFade), weather);
        // Overlapping banks leave only small openings in the panorama cloud sea.
        weatherCoverage = mix(weatherCoverage, mix(.7, 1., smoothstep(.22, .46, weather)), uPanorama);
        float detail = mix(fbm(p * .55), .48, uPanorama * .65);
        vec3 turbulence = vec3(noise3(p * .23), noise3(p * .23 + 31.), noise3(p * .23 + 67.)) - .5;
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
          vec3 puffScale = mix(vec3(1.), vec3(1.15, 1.45, 1.15), uPanorama);
          vec3 q = vec3(local.x, h - cloudHeight, local.y) / (scale * puffScale) + turbulence * 1.7;
          float shape = puffShape(q) + (detail - .48) * .48;
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
        vec3 launchPoint = vec3(p.x-origin.x,h-origin.y,p.z) + turbulence * 1.7;
        float launch = (1. - smoothstep(-.10, .055, puffShape(launchPoint) + (detail - .48) * .48)) * 1.35;
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
          float coverage = smoothstep(.30,.48,weather);
          float detail = noise3(q*4. + 21.);
          vec3 white = mix(vec3(.44,.60,.74),vec3(.91,.94,.95),smoothstep(.42,.70,weather) * .65 + detail*.25);
          white = mix(white,vec3(.43,.57,.70),1.-exp(-sheet.x*.0007));
          col = mix(col,white,coverage*uPanorama);
        }
        return col;
      }
      void main() {
        vec2 xy = (vUv * 2. - 1.) * vec2(uAspect, 1.) * uTanFov;
        vec3 rd = normalize((uCameraMatrix * vec4(xy, -1., 0.)).xyz);
        vec3 base = background(uCamera, rd);
        vec2 outer = sphere(uCamera, rd, uEarthRadius + 32.);
        vec4 cloud = vec4(0.);
        if (outer.y > 0.) {
          float start = max(0., outer.x);
          float end = min(outer.y, mix(1100., 2600., uPanorama));
          vec2 inner = sphere(uCamera, rd, uEarthRadius + .8);
          if (inner.x > 0.) end = min(end, inner.x);
          if (uForeground) end = min(end, uCutoff);
          float t = start + hash(gl_FragCoord.xy) * max(.18, start * .012);
          for (int i = 0; i < 112; i++) {
            if (t > end || cloud.a > .985) break;
            float stepSize = max(.18, t * .012);
            vec3 p = uCamera + rd * t;
            vec3 normal;
            float d = density(p, normal);
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
            // Traverse empty air quickly, then take fine samples inside a bank.
            t += d > .002 ? stepSize : max(.8, stepSize);
          }
        }
        // Screen-space height keeps the black sky aligned with the masthead
        // as the camera changes altitude; smoothstep preserves the soft fade.
        float skyFade = smoothstep(uSkyBand.x, uSkyBand.x + uSkyBand.y, 1. - vUv.y);
        if (uForeground) {
          gl_FragColor = vec4(pow(max(cloud.rgb / max(cloud.a, .001), vec3(0.)), vec3(.4545)), cloud.a * skyFade);
        } else {
          vec3 color = cloud.rgb + base * (1. - cloud.a);
          color = pow(max(color, vec3(0.)), vec3(.4545));
          // Subtle lens falloff, with white highlights kept neutral.
          color *= 1. - .09 * pow(length(vUv - .5), 1.4);
          color = mix(vec3(3., 5., 7.) / 255., color, skyFade);
          gl_FragColor = vec4(color, 1.);
        }
      }
    `,
  });
}
