/**
 * The points store: what a prize is allowed to be, and what a redemption can
 * be in.
 *
 * Browser-safe and shared by both halves — the member's catalogue and the
 * SUP/ADM management page — so a rule the form explains is the same rule the
 * API enforces, the way `@/lib/activities` and `@/lib/flightplan` already work.
 */

export const REDEMPTION_PENDING = 0;
export const REDEMPTION_FULFILLED = 1;
export const REDEMPTION_CANCELLED = 2;

/** Status value to the i18n key describing it. */
export const REDEMPTION_STATUS: Record<number, string> = {
  [REDEMPTION_PENDING]: "pending",
  [REDEMPTION_FULFILLED]: "fulfilled",
  [REDEMPTION_CANCELLED]: "cancelled",
};

/**
 * A cancelled redemption refunds its points, so only these count as spent.
 * Kept here rather than inlined in the query: the balance and the member's
 * history have to agree on what "spent" means.
 */
export const SPENDING_STATUSES = [REDEMPTION_PENDING, REDEMPTION_FULFILLED];

export const LIMITS = {
  name: 120,
  description: 500,
  /** A prize nobody could ever afford is a typo, not a prize. */
  cost: 1_000_000,
  stock: 100_000,
  note: 500,
} as const;

export interface PrizeInput {
  name: string;
  description: string;
  cost: string;
  stock: string;
}

export type PrizeErrors = Partial<Record<keyof PrizeInput, string>>;

/**
 * Validate a prize as typed. Error values are i18n keys under
 * `rewards.manage.errors`, so the same result renders in either language.
 */
export function validatePrize(input: PrizeInput): PrizeErrors {
  const errors: PrizeErrors = {};

  const name = input.name.trim();
  if (!name) errors.name = "nameRequired";
  else if (name.length > LIMITS.name) errors.name = "nameLength";

  if (input.description.trim().length > LIMITS.description) {
    errors.description = "descriptionLength";
  }

  const cost = Number(input.cost);
  if (!Number.isInteger(cost) || cost < 1 || cost > LIMITS.cost)
    errors.cost = "cost";

  const stock = Number(input.stock);
  if (!Number.isInteger(stock) || stock < 0 || stock > LIMITS.stock)
    errors.stock = "stock";

  return errors;
}

/**
 * The wire shape of a prize, converted from what the form holds.
 *
 * The form keeps `cost` and `stock` as strings because that is what an
 * `<input>` binds, and validatePrize reads them with `Number()` without
 * rewriting them. Posting the form object as it stands therefore sends
 * `{"cost": "500"}`, and can-api declares those two fields as Go `int`s:
 * encoding/json refuses a string there outright, so the request never reaches
 * the handler's own validation and comes back 400 `invalidBody`. Every attempt
 * to add or edit a prize failed that way.
 *
 * Call this rather than serialising the form: it is the one place that knows
 * the request is numeric where the form is textual.
 */
export function prizeBody(input: PrizeInput): {
  name: string;
  description: string;
  cost: number;
  stock: number;
} {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    cost: Number(input.cost),
    stock: Number(input.stock),
  };
}

export function hasErrors(errors: PrizeErrors): boolean {
  return Object.keys(errors).length > 0;
}
