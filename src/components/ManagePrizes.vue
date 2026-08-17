<script setup lang="ts">
/**
 * Prize management for SUP/ADM: the catalogue, and the queue of redemptions
 * waiting to be handed over.
 *
 * Cancelling a redemption is what refunds the member — their balance is what
 * activities awarded minus what uncancelled redemptions took — so the button
 * says so rather than leaving someone to issue points by hand afterwards.
 */
import { computed, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  LIMITS,
  REDEMPTION_CANCELLED,
  REDEMPTION_FULFILLED,
  REDEMPTION_PENDING,
  REDEMPTION_STATUS,
  hasErrors,
  prizeBody,
  validatePrize,
  type PrizeErrors,
} from "@/lib/rewards";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Icon,
  Input,
  PageHeader,
} from "@jianyuelab-org/can-ui";
import { apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

interface Prize {
  id: number;
  name: string;
  description: string | null;
  cost: number;
  stock: number;
  redeemedCount: number;
}
interface Redemption {
  id: number;
  username: string;
  name: string | null;
  prizeName: string;
  cost: number;
  status: number;
  note: string | null;
  createdAt: string;
}

const prizes = ref<Prize[]>([]);
const redemptions = ref<Redemption[]>([]);
const loading = ref(true);
const saving = ref(false);
const busyRedemption = ref<number | null>(null);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

/** The form doubles as the editor: an id means "save over that one". */
const editingId = ref<number | null>(null);
const form = ref({ name: "", description: "", cost: "", stock: "" });
const fieldErrors = ref<PrizeErrors>({});

const STATUS_VARIANT: Record<number, "warning" | "success" | "neutral"> = {
  [REDEMPTION_PENDING]: "warning",
  [REDEMPTION_FULFILLED]: "success",
  [REDEMPTION_CANCELLED]: "neutral",
};

const prizeColumns = computed(() => [
  { key: "name", label: t("columns.name") },
  { key: "cost", label: t("columns.cost"), align: "right" as const },
  { key: "stock", label: t("columns.stock"), align: "right" as const },
  {
    key: "redeemedCount",
    label: t("columns.redeemed"),
    align: "right" as const,
  },
  { key: "actions", label: t("columns.actions"), align: "right" as const },
]);

const redemptionColumns = computed(() => [
  { key: "member", label: t("columns.member") },
  { key: "prizeName", label: t("columns.prize") },
  { key: "cost", label: t("columns.cost"), align: "right" as const },
  { key: "status", label: t("columns.status") },
  { key: "actions", label: t("columns.actions"), align: "right" as const },
]);

const pendingCount = computed(
  () => redemptions.value.filter((r) => r.status === REDEMPTION_PENDING).length,
);

function errorText(field: keyof PrizeErrors): string | undefined {
  const key = fieldErrors.value[field];
  return key ? t(`errors.${key}`) : undefined;
}

function resetForm() {
  editingId.value = null;
  form.value = { name: "", description: "", cost: "", stock: "" };
  fieldErrors.value = {};
}

function edit(prize: Prize) {
  editingId.value = prize.id;
  form.value = {
    name: prize.name,
    description: prize.description ?? "",
    cost: String(prize.cost),
    stock: String(prize.stock),
  };
  fieldErrors.value = {};
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function load() {
  loading.value = true;
  try {
    const [prizeRes, redemptionRes] = await Promise.all([
      apiFetch("/api/v1/super/prize"),
      apiFetch("/api/v1/super/redemption"),
    ]);
    if (!prizeRes.ok || !redemptionRes.ok) throw new Error(t("errors.load"));

    // Two routes read one line apart, and can-api answers them in two shapes:
    // `prize` gives the array as `data`, `redemption` wraps it under a name.
    // Reading both the same way left `redemptions` holding an object, and
    // `pendingCount` threw on it every render.
    prizes.value = unwrapList<Prize>(
      (await prizeRes.json().catch(() => ({})))?.data,
      "prizes",
    );
    redemptions.value = unwrapList<Redemption>(
      (await redemptionRes.json().catch(() => ({})))?.data,
      "redemptions",
    );
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.load"),
    };
  } finally {
    loading.value = false;
  }
}

/**
 * can-api's rejection codes for a prize, against the field each one is about.
 * The messages are the same i18n keys validatePrize yields, so a server-side
 * rejection reads identically to the one caught in the browser.
 */
const PRIZE_ERRORS: Record<string, PrizeErrors> = {
  invalidName: { name: "nameLength" },
  invalidCost: { cost: "cost" },
  invalidStock: { stock: "stock" },
};

async function save() {
  const errors = validatePrize(form.value);
  fieldErrors.value = errors;
  if (hasErrors(errors)) return;

  saving.value = true;
  feedback.value = null;

  try {
    const editing = editingId.value;
    const response = await apiFetch(
      editing ? `/api/v1/super/prize/${editing}` : "/api/v1/super/prize",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // Not the form object: it holds cost and stock as the strings an
        // <input> binds, and can-api declares both as numbers.
        body: JSON.stringify(prizeBody(form.value)),
      },
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      // can-api rejects a field with 400 and a machine code, never 422 with a
      // `fields` map -- the branch that read one could not fire. Codes it can
      // return here map onto the same field errors validatePrize produces, so
      // a rejection lands on the offending input rather than in a banner.
      const mapped =
        typeof payload?.error === "string"
          ? PRIZE_ERRORS[payload.error]
          : undefined;
      if (mapped) {
        fieldErrors.value = mapped;
        return;
      }
      throw new Error(t("errors.save"));
    }

    feedback.value = {
      type: "success",
      text: t(editing ? "updated" : "created"),
    };
    resetForm();
    await load();
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.save"),
    };
  } finally {
    saving.value = false;
  }
}

async function remove(prize: Prize) {
  if (!window.confirm(t("confirmDelete", { name: prize.name }))) return;

  feedback.value = null;
  try {
    const response = await apiFetch(`/api/v1/super/prize/${prize.id}`, {
      method: "DELETE",
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const key =
        payload?.error === "alreadyRedeemed" ? "alreadyRedeemed" : "delete";
      feedback.value = { type: "error", text: t(`errors.${key}`) };
      return;
    }

    feedback.value = { type: "success", text: t("deleted") };
    await load();
  } catch {
    feedback.value = { type: "error", text: t("errors.delete") };
  }
}

async function setStatus(redemption: Redemption, status: number) {
  if (status === REDEMPTION_CANCELLED && !window.confirm(t("confirmCancel")))
    return;

  busyRedemption.value = redemption.id;
  feedback.value = null;

  try {
    const response = await apiFetch(
      `/api/v1/super/redemption/${redemption.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!response.ok) throw new Error(t("errors.save"));

    await load();
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.save"),
    };
  } finally {
    busyRedemption.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="gift"
    />

    <AlertBox
      v-if="feedback"
      :variant="feedback.type === 'success' ? 'success' : 'danger'"
      dismissible
      class="mb-6"
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <!-- Create / edit -->
    <Card :title="editingId ? t('editPrize') : t('newPrize')" class="mb-6">
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          v-model="form.name"
          name="name"
          :label="t('fields.name')"
          :error="errorText('name')"
          :maxlength="LIMITS.name"
          required
        />
        <Input
          v-model="form.cost"
          name="cost"
          type="number"
          :label="t('fields.cost')"
          :hint="t('hints.cost')"
          :error="errorText('cost')"
          required
        />
        <Input
          v-model="form.stock"
          name="stock"
          type="number"
          :label="t('fields.stock')"
          :hint="t('hints.stock')"
          :error="errorText('stock')"
          required
        />
        <Input
          v-model="form.description"
          name="description"
          :label="t('fields.description')"
          :hint="t('hints.description')"
          :error="errorText('description')"
          :maxlength="LIMITS.description"
        />
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <Button :loading="saving" @click="save">
          <template #icon><Icon name="checkCircle" class="size-4" /></template>
          {{ editingId ? t("save") : t("create") }}
        </Button>
        <Button v-if="editingId" variant="secondary" @click="resetForm">
          {{ t("cancelEdit") }}
        </Button>
      </div>
    </Card>

    <!-- Catalogue -->
    <Card :title="t('catalogue')" class="mb-6">
      <DataTable
        :columns="prizeColumns"
        :rows="prizes"
        row-key="id"
        dense
        :loading="loading"
        :loading-label="t('loading')"
        :empty="t('noPrizes')"
        :empty-description="t('noPrizesHint')"
      >
        <template #cell-name="{ row }">
          <span class="font-medium text-ink">{{ row.name }}</span>
          <span v-if="row.description" class="mt-0.5 block text-xs text-faint">
            {{ row.description }}
          </span>
        </template>
        <template #cell-stock="{ row }">
          <Badge :variant="row.stock > 0 ? 'info' : 'neutral'" size="sm">
            {{ row.stock }}
          </Badge>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="secondary" @click="edit(row)">
              {{ t("edit") }}
            </Button>
            <Button size="sm" variant="danger" @click="remove(row)">
              {{ t("delete") }}
            </Button>
          </div>
        </template>
      </DataTable>
    </Card>

    <!-- Redemption queue -->
    <Card
      :title="t('queue')"
      :subtitle="t('queueHint', { count: String(pendingCount) })"
    >
      <DataTable
        :columns="redemptionColumns"
        :rows="redemptions"
        row-key="id"
        dense
        :loading="loading"
        :loading-label="t('loading')"
        :empty="t('noRedemptions')"
      >
        <template #cell-member="{ row }">
          <span class="font-medium text-ink">{{ row.name ?? "—" }}</span>
          <span class="tnum mt-0.5 block font-mono text-xs text-faint">{{
            row.username
          }}</span>
        </template>
        <template #cell-status="{ row }">
          <Badge :variant="STATUS_VARIANT[row.status] ?? 'neutral'" size="sm">
            {{ t(`status.${REDEMPTION_STATUS[row.status] ?? "pending"}`) }}
          </Badge>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <Button
              v-if="row.status !== REDEMPTION_FULFILLED"
              size="sm"
              :loading="busyRedemption === row.id"
              @click="setStatus(row, REDEMPTION_FULFILLED)"
            >
              {{ t("markFulfilled") }}
            </Button>
            <Button
              v-if="row.status !== REDEMPTION_CANCELLED"
              size="sm"
              variant="secondary"
              :loading="busyRedemption === row.id"
              @click="setStatus(row, REDEMPTION_CANCELLED)"
            >
              {{ t("cancelRedemption") }}
            </Button>
          </div>
        </template>
      </DataTable>
    </Card>
  </div>
</template>
