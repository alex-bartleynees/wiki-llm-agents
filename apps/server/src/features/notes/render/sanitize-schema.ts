import { defaultSchema, type Options } from "rehype-sanitize";

type Attributes = NonNullable<NonNullable<Options["attributes"]>[string]>;

/** The default attributes for a tag, with any restricted `className` rule replaced by a free one. */
const withClassName = (tag: string, ...extra: Attributes): Attributes => [
  ...(defaultSchema.attributes?.[tag] ?? []).filter((attribute) => !(Array.isArray(attribute) && attribute[0] === "className")),
  "className",
  ...extra,
];

/**
 * GitHub's sanitize schema (no scripts, event handlers, styles, or `javascript:`
 * URLs), plus the classes and attributes the note renderer adds: link and embed
 * classes, callout containers, and `<details>` for foldable callouts.
 * Heading ids and external-link attributes are added after sanitising.
 */
export const sanitizeSchema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: withClassName("a"),
    span: withClassName("span"),
    img: withClassName("img"),
    div: withClassName("div", "dataCallout"),
    details: withClassName("details", "dataCallout"),
    summary: withClassName("summary"),
  },
};
