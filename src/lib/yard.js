
function estimateRange(budget) {
  const ranges = {
    "Under $2,500": "$900–$2,500",
    "$2,500–$5,000": "$2,500–$5,000",
    "$5,000–$10,000": "$5,000–$10,000",
    "$10,000–$25,000": "$10,000–$25,000",
    "$25,000+": "$25,000+",
    "Just give me ideas": "$4,500–$7,000"
  };
  return ranges[budget] || "$4,500–$7,000";
}

function buildPlan(style, features) {
  const out = [
    "Defined planting beds and cleaner landscape edges",
    "Layered foundation planting for curb appeal",
    "Coordinated mulch, rock, or groundcover",
    "Improved front approach and visual balance"
  ];
  const featureMap = {
    "Keep existing trees": "Preserve existing mature trees",
    "Add grass": "Fresh lawn or turf zone",
    "Artificial turf": "Low-maintenance artificial turf area",
    "Add flowers": "Seasonal flower color beds",
    "Add shrubs": "Structured shrub groupings",
    "Add patio": "Patio or sitting area",
    "Add walkway": "Paver or stone walkway",
    "Add lighting": "Path and accent landscape lighting",
    "Add fire pit": "Fire pit gathering area"
  };
  (features || []).forEach(f => {
    if (featureMap[f] && !out.includes(featureMap[f])) out.push(featureMap[f]);
  });
  return out.slice(0, 8);
}

function buildPrompt(style, features, budget, notes, variationIndex) {
  const styleMap = {
    "Modern": "clean modern landscaping with structured beds, crisp lines, elegant hardscape, and polished curb appeal",
    "Low Maintenance": "low-maintenance landscaping with hardy plants, simplified beds, mulch or decorative rock, and tidy evergreen structure",
    "Tropical": "lush tropical landscaping with layered greenery and a resort-inspired feel",
    "Luxury": "upscale luxury landscaping with premium materials, refined planting composition, and dramatic curb appeal",
    "Drought-Tolerant": "drought-tolerant landscaping with decorative gravel, water-wise plants, and clean climate-conscious structure",
    "Cottage Garden": "soft cottage-garden landscaping with flowers, layered beds, charming pathways, and an inviting garden feel"
  };

  return `
Edit the supplied residential yard photo into a realistic professional landscape redesign.

PRESERVE THE PROPERTY:
- Keep the exact same house architecture, roof, windows, doors, garage, driveway, sidewalk, fences, neighboring structures, utility elements, and camera viewpoint.
- Do not replace the home with a different house.
- Do not change the street, lot shape, or property geometry.
- The result must clearly look like the same real property after landscaping improvements.

DESIGN:
- Requested style: ${styleMap[style] || style}.
- Requested features: ${(features || []).length ? features.join(', ') : 'professional landscaping appropriate to the property'}.
- Budget context: ${budget || 'ideas only'}.
- User notes: ${notes || 'none'}.
- Variation ${variationIndex + 1}: create a distinct design choice from the other variation while keeping the same requested style.

QUALITY:
- Photorealistic residential landscaping.
- Believable plant scale and placement.
- Attractive but buildable design.
- Strong before/after visual improvement.
- Natural lighting consistent with the source photo.
- No fantasy elements, people, signs, text, or architectural redesign.
`;
}

module.exports = { estimateRange, buildPlan, buildPrompt };
