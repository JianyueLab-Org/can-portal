<script setup lang="ts">
import { ref } from "vue";
import { AlertBox, Button, Card, Input, Select } from "@jianyuelab-org/can-ui";
import { api } from "@/lib/canApi";
import { createTranslator } from "@/lib/i18n";
import { errorKey } from "@/lib/vaStaff";
import { airportTierRequest } from "@/lib/vaCatalogue";
const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);
const icao = ref("");
const tier = ref("3");
const airport = ref<{ icao: string; name: string; tier: number } | null>(null);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const options = [1, 2, 3, 4, 5].map((value) => ({
  value: String(value),
  label: String(value),
}));

async function lookup() {
  if (busy.value) return;
  const code = icao.value.trim().toUpperCase();
  airport.value = null;
  notice.value = "";
  if (!/^[A-Z]{4}$/.test(code)) {
    error.value = t("tiers.invalidTier");
    return;
  }
  busy.value = true;
  error.value = "";
  const result = await api<{ icao: string; name: string; tier: number }>(
    `/api/v1/va/airports/${code}`,
  );
  busy.value = false;
  if (!result.ok) {
    error.value = t(`errors.${errorKey(result.error)}`);
    return;
  }
  airport.value = result.data;
  icao.value = code;
  tier.value = String(result.data.tier);
}

async function save(reset: boolean) {
  if (
    busy.value ||
    !airport.value ||
    airport.value.icao !== icao.value.trim().toUpperCase()
  )
    return;
  const request = airportTierRequest(
    airport.value.icao,
    reset ? "" : tier.value,
  );
  if (!request.ok) {
    error.value = t("tiers.invalidTier");
    return;
  }
  error.value = "";
  notice.value = "";
  busy.value = true;
  const result = await api(request.path, {
    method: "PUT",
    body: JSON.stringify(request.body),
  });
  if (!result.ok) {
    busy.value = false;
    error.value = t(`errors.${errorKey(result.error)}`);
    return;
  }
  const refreshed = await api<{ icao: string; name: string; tier: number }>(
    `/api/v1/va/airports/${airport.value.icao}`,
  );
  busy.value = false;
  notice.value = t(reset ? "tiers.resetDone" : "tiers.saved");
  if (refreshed.ok) {
    airport.value = refreshed.data;
    tier.value = String(refreshed.data.tier);
  } else {
    airport.value = null;
    error.value = t(`errors.${errorKey(refreshed.error)}`);
  }
}
</script>

<template>
  <Card class="mt-6 p-5">
    <h2 class="text-base font-semibold text-ink">{{ t("tiers.title") }}</h2>
    <p class="mt-1 text-sm text-muted">{{ t("tiers.help") }}</p>
    <AlertBox v-if="error" variant="danger" class="mt-4">{{ error }}</AlertBox>
    <AlertBox v-if="notice" variant="success" class="mt-4">{{
      notice
    }}</AlertBox>
    <form class="mt-4 flex flex-wrap items-end gap-3" @submit.prevent="lookup">
      <Input
        v-model="icao"
        :label="t('tiers.airport')"
        :maxlength="4"
        :disabled="busy"
        required
        @update:model-value="airport = null"
      />
      <Button
        type="submit"
        variant="secondary"
        :loading="busy"
        :disabled="busy"
        >{{ t("tiers.lookup") }}</Button
      >
    </form>
    <div v-if="airport" class="mt-4 space-y-4">
      <p class="text-sm text-ink">
        {{ airport.icao }} · {{ airport.name }} ·
        {{ t("tiers.current", { tier: String(airport.tier) }) }}
      </p>
      <Select
        v-model="tier"
        :label="t('tiers.tier')"
        :options="options"
        :disabled="busy"
      />
      <div class="flex flex-wrap gap-2">
        <Button :loading="busy" :disabled="busy" @click="save(false)">{{
          t("tiers.save")
        }}</Button>
        <Button variant="secondary" :disabled="busy" @click="save(true)">{{
          t("tiers.reset")
        }}</Button>
      </div>
    </div>
  </Card>
</template>
