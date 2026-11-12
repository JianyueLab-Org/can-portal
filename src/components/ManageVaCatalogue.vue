<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  Select,
  Skeleton,
} from "@jianyuelab-org/can-ui";
import { api } from "@/lib/canApi";
import { createTranslator } from "@/lib/i18n";
import { errorKey, formatMoney } from "@/lib/vaStaff";
import {
  aircraftTypeDraft,
  aircraftTypeInput,
  aircraftTypePath,
  aircraftTypesPath,
  TYPE_NUMBER_FIELDS,
  type AircraftType,
} from "@/lib/vaCatalogue";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);
const types = ref<AircraftType[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref("");
const editing = ref<string | null>(null);
const form = ref(aircraftTypeDraft());
const stateOptions = [
  { value: "active", label: t("catalogue.active") },
  { value: "inactive", label: t("catalogue.inactive") },
];
const columns = [
  { key: "name", label: t("catalogue.name") },
  { key: "capacity", label: t("catalogue.capacity") },
  { key: "price", label: t("catalogue.price") },
  { key: "active", label: t("catalogue.state") },
  { key: "actions", label: "" },
];

async function load() {
  loading.value = true;
  const result = await api<{ items: AircraftType[] }>(aircraftTypesPath());
  loading.value = false;
  if (!result.ok) {
    error.value = t(`errors.${errorKey(result.error)}`);
    return;
  }
  types.value = result.data.items;
}

function edit(type: AircraftType) {
  if (busy.value) return;
  form.value = aircraftTypeDraft(type);
  editing.value = type.icao;
  error.value = "";
  notice.value = "";
}

function reset() {
  form.value = aircraftTypeDraft();
  editing.value = null;
}

async function save() {
  if (busy.value) return;
  error.value = "";
  notice.value = "";
  const request = aircraftTypeInput(form.value);
  if (!request.ok) {
    error.value = t(`catalogue.${request.error}`);
    return;
  }
  busy.value = true;
  const { icao, ...patch } = request.body;
  const result = await api<AircraftType>(
    editing.value ? aircraftTypePath(editing.value) : aircraftTypesPath(),
    {
      method: editing.value ? "PATCH" : "POST",
      body: JSON.stringify(editing.value ? patch : request.body),
    },
  );
  if (!result.ok) {
    busy.value = false;
    error.value = t(`errors.${errorKey(result.error)}`);
    return;
  }
  notice.value = t("catalogue.saved", { icao });
  reset();
  await load();
  busy.value = false;
}

async function setActive(type: AircraftType) {
  if (busy.value) return;
  error.value = "";
  notice.value = "";
  busy.value = true;
  const result = await api<AircraftType>(aircraftTypePath(type.icao), {
    method: "PATCH",
    body: JSON.stringify({ active: !type.active }),
  });
  if (!result.ok) {
    busy.value = false;
    error.value = t(`errors.${errorKey(result.error)}`);
    return;
  }
  if (editing.value === type.icao) form.value.active = result.data.active;
  notice.value = t("catalogue.saved", { icao: type.icao });
  await load();
  busy.value = false;
}

onMounted(load);
</script>

<template>
  <section class="space-y-6">
    <p class="text-sm text-muted">{{ t("catalogue.help") }}</p>
    <AlertBox v-if="error" variant="danger">{{ error }}</AlertBox>
    <AlertBox v-if="notice" variant="success">{{ notice }}</AlertBox>
    <Skeleton v-if="loading" variant="table" />
    <DataTable v-else :columns="columns" :rows="types" row-key="icao" dense>
      <template #empty
        ><EmptyState icon="paperAirplane" :title="t('catalogue.empty')"
      /></template>
      <template #cell-name="{ row }"
        ><span class="font-mono">{{ row.icao }}</span> {{ row.name }}</template
      >
      <template #cell-capacity="{ row }"
        ><span class="tnum"
          >{{ row.seats }} / {{ row.cargoKg }} kg</span
        ></template
      >
      <template #cell-price="{ row }"
        ><span class="tnum">{{ formatMoney(row.price) }}</span></template
      >
      <template #cell-active="{ row }"
        ><Badge :variant="row.active ? 'success' : 'neutral'">{{
          t(row.active ? "catalogue.active" : "catalogue.inactive")
        }}</Badge></template
      >
      <template #cell-actions="{ row }">
        <div class="flex flex-wrap justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            :disabled="busy"
            @click="edit(row)"
            >{{ t("params.edit") }}</Button
          >
          <Button
            size="sm"
            variant="secondary"
            :disabled="busy"
            @click="setActive(row)"
            >{{
              t(row.active ? "catalogue.deactivate" : "catalogue.activate")
            }}</Button
          >
        </div>
      </template>
    </DataTable>
    <Card class="p-5">
      <h2 class="text-base font-semibold text-ink">
        {{ t(editing ? "catalogue.edit" : "catalogue.create") }}
      </h2>
      <form class="mt-4 space-y-4" @submit.prevent="save">
        <fieldset
          :disabled="busy"
          class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <Input
            v-model="form.icao"
            :label="t('catalogue.icao')"
            :disabled="editing !== null"
            :maxlength="4"
            required
          />
          <Input v-model="form.name" :label="t('catalogue.name')" required />
          <Select
            :model-value="form.active ? 'active' : 'inactive'"
            :label="t('catalogue.state')"
            :options="stateOptions"
            @update:model-value="form.active = $event === 'active'"
          />
          <Input
            v-for="field in TYPE_NUMBER_FIELDS"
            :key="field"
            v-model="form[field]"
            :label="t(`catalogue.fields.${field}`)"
            inputmode="decimal"
            required
          />
        </fieldset>
        <div class="flex gap-2">
          <Button type="submit" :loading="busy" :disabled="busy">{{
            t("params.save")
          }}</Button>
          <Button
            v-if="editing"
            variant="secondary"
            :disabled="busy"
            @click="reset"
            >{{ t("params.cancel") }}</Button
          >
        </div>
      </form>
    </Card>
  </section>
</template>
