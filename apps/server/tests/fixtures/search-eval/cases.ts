/** Questions stay separate from the keyword query: FTS does not paraphrase. */
export const cases = [
  { question: "Which machine handles production now?", query: "roaster", relevant: ["Decisions/2026-01 Roaster Upgrade.md", "Decisions/2025-03 Roaster Choice.md"], current: "Decisions/2026-01 Roaster Upgrade.md", fact: "Aillio Bullet" },
  { question: "Where do we buy caffeine-free beans these days?", query: "decaf", relevant: ["Sourcing/Decaf Supplier.md", "Decisions/2026-02 Decaf Supplier Change.md"], current: "Decisions/2026-02 Decaf Supplier Change.md", fact: "Bean Collective" },
  { question: "What retail pack weights do we sell?", query: "bags", relevant: ["Business/Packaging.md", "Decisions/2025-11 Bag Sizes.md", "Business/Farmers Market.md"], current: "Decisions/2025-11 Bag Sizes.md", fact: "250 g and 1 kg" },
  { question: "What should a café pay for our house blend?", query: "wholesale", relevant: ["Business/Wholesale Pricing.md"], current: "Business/Wholesale Pricing.md", fact: "$38" },
  { question: "How do we keep green beans dry?", query: "storage", relevant: ["Sourcing/Green Bean Storage.md"], current: "Sourcing/Green Bean Storage.md", fact: "GrainPro" },
  { question: "What did we do about the neighbours complaining?", query: "flue", relevant: ["Roasting/Smoke and Ventilation.md", "Decisions/2026-01 Roaster Upgrade.md"], current: "Roasting/Smoke and Ventilation.md", fact: "taller flue" },
] as const;
