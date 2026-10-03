# AIR flight foundation

Serve the folder with any static HTTP server (for example `python3 -m http.server 4173`) and open `http://localhost:4173`. ES modules need HTTP rather than a `file://` URL. There is no build step, package install, remote font, or runtime CDN dependency. Three.js 0.169.0 and its MIT license are in `js/vendor/`.

- `index.html`: three accessible chapters and the minimal fixed interface.
- `css/flight.css`: responsive layout, static fallback, and reduced-motion layout.
- `js/flight.js`: scroll timeline, camera keyframes, lighting, exhaust, and render scheduling. The `states` array controls the whole flight. Scrolling backward reverses the same timeline; time only affects ambient movement.
- `js/clouds.js`: ray-marched rounded cloud clusters, smooth directional lighting, the launch disturbance, ocean haze, distant cloud billboards, and a horizon sheet. All textures are generated locally. `density()` controls nearby cloud coverage, height, and detail.
- `js/rocket.js`: the placeholder model, engine flame, and preallocated particle buffers.

## Replacing the rocket

Replace the contents of `model` in `createRocket()` with a loaded character/GLTF scene. Keep the returned `rig` and exhaust attachments. Normalize the replacement to roughly 3.4 units tall, with +Y pointing in the direction of travel and the nozzle attachment at local `(0, -1.65, 0)`. The model's origin follows the timeline; its contents can be animated independently. If the character has a different exhaust position, update the nozzle offset in `pose()` as well.

## Rendering budget and accessibility

Clouds render at a separate, initially capped 320,000-pixel resolution with a 112-step maximum, coarse traversal of empty air, fine sampling inside clouds, and early opacity exit. A small reconstruction filter smooths the cloud pass without blurring the rocket. Sustained slow frames reduce this budget. The model renders separately at up to 1.6 device pixel ratio. At rest, cloud updates are limited to 24 per second; during camera movement they follow the frame loop. No per-frame geometry creation or particle allocations are needed.

The cloud shader writes two color attachments in one WebGL2 render target: the complete background and the accumulated cloud volume up to the rocket's cutoff distance. This replaces the second volume traversal during breakthrough while preserving its sampling, opacity, lighting, and foreground composition. Pixels wholly inside the black masthead band return before sampling the volume. Both attachments are written on every cloud update, including transparent foreground pixels, so changing views cannot retain stale occlusion.

Cloud updates track actual camera/burst/panorama changes. Scrolling through the stationary final hold retains the 24 fps drift cadence. Before ignition, invisible exhaust buffers are not updated and unchanged cloud frames do not trigger another full-resolution composition. Resolution, cloud thickness, distant cloud coverage, and ray-march limits are unchanged by these optimizations.

The motion button freezes ambient drift, flame flicker, and particles while retaining scroll control. Reduced-motion preference uses three static camera views with native scrolling, disables easing, and starts ambient animation paused. Rendering stops in hidden tabs and while paused at a settled view. No-JavaScript and unavailable/lost WebGL contexts retain a CSS sky and descriptive text.

The October 2026 optimization was compared with the previous renderer at fixed time and progress, using the full cloud pixel budget. Five desktop captures (opening, two breakthrough positions, close-up, and panorama) were pixel-identical. The mobile panorama was also identical; opening/breakthrough captures had differences in fewer than 0.08% of pixels, with differences greater than 3/255 confined to the animated chapter navigation.

Headless Chromium checks also covered reduced-motion navigation, pause/resume, live preference changes, smooth-scroll settling, resize, context loss/restoration, and the no-JavaScript fallback. Scheduler checks confirmed one volume traversal during breakthrough, cached clouds during the panorama hold, and no redundant opening draws or hidden particle uploads. Lifecycle checks used a 12,000-pixel cloud budget to keep software WebGL practical; visual comparisons retained the production budget.

A separate synchronized readback comparison used equal 40,000-pixel cloud targets, fixed time, one warm-up and three samples per view in software WebGL. Median render times before/after were 579/470 ms at the opening, 865/376 ms and 774/382 ms at two breakthrough positions, and 184/192 ms at the panorama. These demonstrate reduced breakthrough work, not expected laptop frame rates. Hardware GPU profiling is still needed to quantify real-device gains.

## Cloud style and launch burst

The opening composition follows the Desktop references `clouds1.jpg` and `clouds2.jpg`: bright, tall cumulus banks across the lower frame with blue shadow detail and a deep blue sky. The references are visual guides; the scene remains a procedural 3D volume. `puffShape()` joins four lobes into each tower, domain warping and multiscale noise break up the surfaces, and a sunward density probe supplies the billow shadows.

The camera moves into the launch bank through progress 0.25, then follows the rocket into a close-up at 0.38–0.54. Following Desktop reference `clouds3.jpg`, it pulls back through 0.80 into a wide daylight panorama and holds that composition through the final section. The small rocket is anchored at 68% across on desktop (74% in portrait) and at least 24 pixels below the masthead. A long, white, billowing plume runs diagonally toward the bottom of the frame. Framing settles by 0.68 to keep the subject clear of the top edge throughout the pullback.

`uPanorama` blends the deep opening sky into blue daylight and haze, enlarges the rounded cloud banks, and retains a connected lower deck to cover the ocean. The panorama retains the opening's surface turbulence and roughly uniform cloud proportions instead of stretching banks sideways and smoothing their detail. The final camera leaves room for blue sky above the fuller cloud horizon. The curved shell radius increases from 1,400 to 12,000 units during the pullback, creating the reference's nearly level horizon. Exhaust uses 300 points on phones and 420 on desktop, with denser sampling near the nozzle and viewport-scaled white smoke in the wide view. No reference photograph is shipped or used as a background.

The final panorama limits volumetric tracing to 320 world units (previously 2,600), fading nearby volume from 220–320 units into four world-space rows of cloud billboards. Each distant ray samples at most eight cloud cards, with no per-card density or shadow marching. A 768 × 192 RGBA atlas containing four cloud variants is baked once on the GPU from the same `puffShape()`, turbulence, and sun/shadow palette as the nearby volume. The cards vary in size, placement, and altitude, blend through distance haze, and drift with the nearby banks. A cheap procedural sheet fills the far horizon beneath them. The atlas is rebaked after WebGL context restoration. The opening and launch retain their original volume range and detail.

An October 2026 synchronized software-WebGL comparison at 40,000 cloud pixels measured median final-view render time of 214 ms before and 181 ms after (one warm-up, three samples per view). Opening and breakthrough medians were effectively unchanged; the mid-pullback sample rose from 394 to 407 ms while both representations blend. These are diagnostic software-renderer measurements, not hardware frame-rate predictions. Production cloud resolution and the 112-step maximum remain unchanged. Desktop and mobile production-resolution captures, reduced-motion navigation in both directions, and the no-JavaScript fallback were checked without browser errors. The rebaked panorama after WebGL context restoration matched the original canvas capture pixel for pixel.

The sky keeps a near-black band at half the masthead height (55 pixels on desktop, 45 on mobile) throughout the timeline. `uSkyBand` receives half the measured header height on resize and adds a smooth 9vh fade, clamped to 50–90 pixels, into the scene below. The CSS fallback uses the same dimensions and color. A static CSS overlay adds sparse, faint 1–2 pixel stars along the very top, with six stars per 800 pixels of width in both the rendered and fallback views.

The `uBurst` uniform maps scroll progress 0.21–0.39 to an expanding, lobed pressure ring and three rising/outward billows at the top of the launch cloud. It temporarily opens the cloud around the rocket, then dissipates before the close-up hold. The effect shares the cloud volume and lighting, requires no particle allocations, and reverses deterministically when scrolling upward. Reduced-motion views skip this transition.
