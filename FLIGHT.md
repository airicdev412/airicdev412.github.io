# AIR flight foundation

Serve the folder with any static HTTP server (for example `python3 -m http.server 4173`) and open `http://localhost:4173`. ES modules need HTTP rather than a `file://` URL. There is no build step, package install, remote font, or runtime CDN dependency. Three.js 0.169.0 and its MIT license are in `js/vendor/`.

- `index.html`: three accessible chapters and the minimal fixed interface.
- `css/flight.css`: responsive layout, static fallback, and reduced-motion layout.
- `js/flight.js`: scroll timeline, camera keyframes, lighting, exhaust, and render scheduling. The `states` array controls the whole flight. Scrolling backward reverses the same timeline; time only affects ambient movement.
- `js/clouds.js`: ray-marched rounded cloud clusters, smooth directional lighting, the launch disturbance, ocean haze, and a distant cloud sheet. All textures are generated locally. `density()` controls cloud coverage, height, and detail.
- `js/rocket.js`: the placeholder model, engine flame, and preallocated particle buffers.

## Replacing the rocket

Replace the contents of `model` in `createRocket()` with a loaded character/GLTF scene. Keep the returned `rig` and exhaust attachments. Normalize the replacement to roughly 3.4 units tall, with +Y pointing in the direction of travel and the nozzle attachment at local `(0, -1.65, 0)`. The model's origin follows the timeline; its contents can be animated independently. If the character has a different exhaust position, update the nozzle offset in `pose()` as well.

## Rendering budget and accessibility

Clouds render at a separate, initially capped 320,000-pixel resolution with a 112-step maximum, coarse traversal of empty air, fine sampling inside clouds, and early opacity exit. A small reconstruction filter smooths the cloud pass without blurring the rocket. Sustained slow frames reduce this budget. The model renders separately at up to 1.6 device pixel ratio. At rest, cloud updates are limited to 24 per second; during camera movement they follow the frame loop. No per-frame geometry creation or particle allocations are needed.

The motion button freezes ambient drift, flame flicker, and particles while retaining scroll control. Reduced-motion preference uses three static camera views with native scrolling, disables easing, and starts ambient animation paused. Rendering stops in hidden tabs and while paused at a settled view. No-JavaScript and unavailable/lost WebGL contexts retain a CSS sky and descriptive text.

The three chapter views on desktop and portrait screens, reduced-motion chapter navigation and return, two fixed burst frames, no-JavaScript, and unavailable WebGL were checked in headless Chromium without page errors. The continuous-scroll and live preference-change runs stalled in software WebGL; full-motion smoothness and actual device frame rates still need hardware verification.

## Cloud style and launch burst

The opening composition follows the Desktop references `clouds1.jpg` and `clouds2.jpg`: bright, tall cumulus banks across the lower frame with blue shadow detail and a deep blue sky. The references are visual guides; the scene remains a procedural 3D volume. `puffShape()` joins four lobes into each tower, domain warping and multiscale noise break up the surfaces, and a sunward density probe supplies the billow shadows.

The camera moves into the launch bank through progress 0.25, then follows the rocket into a close-up at 0.38–0.54. Following Desktop reference `clouds3.jpg`, it pulls back through 0.80 into a wide daylight panorama and holds that composition through the final section. The small rocket is anchored at 68% across on desktop (74% in portrait) and at least 24 pixels below the masthead. A long, white, billowing plume runs diagonally toward the bottom of the frame. Framing settles by 0.68 to keep the subject clear of the top edge throughout the pullback.

`uPanorama` blends the deep opening sky into blue daylight and haze, enlarges the rounded cloud banks, and retains a connected lower deck to cover the ocean. The final camera leaves room for blue sky above the fuller cloud horizon. The curved shell radius increases from 1,400 to 12,000 units during the pullback, creating the reference's nearly level horizon. A procedural distant cloud sheet extends the weather layers beyond the detailed volume. Exhaust uses 300 points on phones and 420 on desktop, with denser sampling near the nozzle and viewport-scaled white smoke in the wide view. No reference photograph is shipped or used as a background.

The sky keeps a near-black band matching the masthead height (110 pixels on desktop, 90 on mobile) throughout the timeline. `uSkyBand` receives the measured header height on resize and adds a smooth 18vh fade, clamped to 100–180 pixels, into the scene below. The CSS fallback uses the same dimensions and color.

The `uBurst` uniform maps scroll progress 0.21–0.39 to an expanding, lobed pressure ring and three rising/outward billows at the top of the launch cloud. It temporarily opens the cloud around the rocket, then dissipates before the close-up hold. The effect shares the cloud volume and lighting, requires no particle allocations, and reverses deterministically when scrolling upward. Reduced-motion views skip this transition.
