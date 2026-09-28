# Иллюстрация среднего пальца

Файл: `middle-finger.png`, 1024 × 1536, PNG с прозрачностью. Создан встроенным инструментом ImageGen для страницы блокировки; CLI и внешние API не использовались. Отображается уменьшенным с сохранением пропорций, чтобы оставаться чётким на Retina-экранах.

## Исходный промпт

```text
Use case: stylized-concept.
Asset type: a single high-resolution transparent PNG icon for a Chrome extension blocking page.
Primary request: recreate the familiar yellow middle-finger hand emoji 🖕 as a very sharp, polished 3D emoji-style illustration. One upright yellow hand, back of the hand facing the viewer, middle finger extended straight up, other fingers folded into a compact fist, thumb curled at the left edge, short visible wrist with a clean softly curved cutoff. Keep the classic emoji silhouette, friendly smooth rounded anatomy, elongated slender middle finger, warm golden yellow material, soft natural shading and subtle highlights. The hand should look like the standard yellow middle-finger emoji, just far higher quality, not a different gesture.
Composition: isolated complete hand and wrist, centered. Portrait transparent canvas, minimum 1024 pixels tall. Hand fills about 92% of the canvas height with a small even transparent margin. No cropping of the fingertip or wrist. Back of hand rather than palm; no visible front-facing fingernail on the extended finger.
Quality: crisp anti-aliased contours, high-resolution clean smooth shading, no pixelation, no blur, no grain. This will be displayed at 100–190 CSS pixels high on a dark background, so preserve a clean silhouette.
Background: genuinely transparent alpha, no colored backdrop, no checkerboard baked in, no ground plane, no cast shadow outside the hand, no glow or border.
Constraints: exactly one hand and one extended middle finger; no extra fingers, jewelry, sleeves, words, logos, watermark, background or other objects.
```

## Финальная правка прозрачности

К сгенерированному изображению применён следующий промпт встроенным ImageGen с `transparent_background: true`:

```text
Use case: background-extraction.
Edit the supplied yellow middle-finger hand image. KEEP the complete hand itself exactly as it is: same shape, same finger pose, same yellow colors, same shading, same framing and high detail. Change ONLY the exterior background and silhouette edges. Remove ALL of the golden glow, yellow haze, black background, and shadow outside the solid hand. Everything outside the actual physical contour of the hand and wrist must have alpha zero (fully transparent). Only a very thin normal anti-aliasing edge is allowed at the hand boundary. This is a clean UI cutout, not an illuminated object: no aura, no halo, no bloom, no shadow, no backdrop, no checkerboard pattern. Return a high-resolution transparent PNG, ideally the same 1024 by 1536 canvas. Preserve the complete fingertip and wrist; do not crop them. Do not change the hand.
```
