# Shared UI primitives

Buttons, text inputs and cards share their look through `Button`, `Input` and `Card` in `apps/web/src/lib/ui/primitives/`. Features choose a look through props and don't restyle the primitives.

- `Button` takes `variant` (`secondary`, `primary`, `link`), `size`, `danger` and `pill`. It renders a link when given `href`. Its default `type` is `button`, so a form's submit button sets `type="submit"`.
- `Input` is for text-like values. It takes `size` and `mono`. Checkboxes, radios, file inputs, selects and textareas stay native.
- `Card` renders a `section`. `node` binds its element.

A feature passes `class` only to place a primitive: margins, alignment, fixed position or visibility. The Skills page's floating New skill button is the one exception: it becomes a pill on phones only. Svelte doesn't scope a class passed to a component, so the feature's rule is a scoped parent with `:global(.name)`.

Controls that are not plain buttons stay native and own their styles: list rows, tabs, icon-only close buttons, the composer's send button and the new-thread form, whose controls share one row and height.

`Button` and `Input` grow on screens up to 899px wide. `Input` text is 16px there, so focusing a field doesn't zoom on iOS.
