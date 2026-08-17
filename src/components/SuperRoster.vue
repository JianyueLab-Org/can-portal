<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  Toggle,
  useOverlay,
} from "@jianyuelab-org/can-ui";
import { divisionTrans } from "@/lib/tools";
import { apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{
  messages: Record<string, unknown>;
  sessionUserId: string;
}>();
const t = createTranslator(props.messages);

interface Division {
  id: number;
  region: number;
  del: boolean;
  gnd: boolean;
  app: boolean;
  twr: boolean;
  ctr: boolean;
  instructor: boolean;
  status: boolean;
  home: boolean;
  director: boolean;
  createdAt: string;
  updatedAt: string;
}

const controllers = ref<Division[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const searchTerm = ref("");
const statusFilter = ref<string>("all"); // all, active, inactive
const permissionFilter = ref<string>("all"); // all, instructor, director
const selectedController = ref<Division | null>(null);
const isManagePanelOpen = ref(false);
// Escape to close, focus trapped in the dialog, page behind locked.
const managePanel = useOverlay(isManagePanelOpen);
// The dialog had role="dialog" + aria-modal but no accessible name, so a
// screen reader announced it as an unlabelled dialog.
const manageTitleId = useId();
const editingController = ref<Division | null>(null);
const saving = ref(false);
// Surfaced inside the dialog rather than through alert(), which the rest of
// the app does not use and which a screen reader announces out of context.
const saveError = ref<string | null>(null);

/**
 * (Re-)read the roster.
 *
 * Shared with the save path, which re-reads rather than patching the row in
 * place. Two reasons it has to: `division` is keyed by **(id, region)**, so a
 * member holding two divisions has two rows carrying the same `id` and the old
 * `controller.id === id` match rewrote both of them; and `updatedAt` is the
 * server's, which a local merge would have to invent.
 */
async function loadRoster(): Promise<boolean> {
  const response = await apiFetch("/api/v1/super/roster");
  const data = await response.json();
  if (!response.ok || data.status !== 200) return false;
  controllers.value = unwrapList<Division>(data.data, "controllers");
  return true;
}

onMounted(async () => {
  try {
    if (!(await loadRoster())) {
      error.value = t("fetchError");
    }
  } catch (err) {
    error.value = t("fetchError");
    console.error("Error:", err);
  } finally {
    loading.value = false;
  }
});

// 过滤数据
const filteredControllers = computed(() => {
  return controllers.value.filter((controller) => {
    // 搜索过滤
    const searchMatch = controller.id
      .toString()
      .includes(searchTerm.value.toLowerCase());

    // 状态过滤
    let statusMatch = true;
    if (statusFilter.value === "active") statusMatch = controller.status;
    if (statusFilter.value === "inactive") statusMatch = !controller.status;

    // 权限过滤
    let permissionMatch = true;
    if (permissionFilter.value === "instructor")
      permissionMatch = controller.instructor;
    if (permissionFilter.value === "director")
      permissionMatch = controller.director;

    return searchMatch && statusMatch && permissionMatch;
  });
});

// 排序后的过滤数据
const sortedControllers = computed(() => {
  return [...filteredControllers.value].sort((a, b) => {
    // 先按状态排序（活跃在前）
    if (a.status && !b.status) return -1;
    if (!a.status && b.status) return 1;
    // 再按教员排序
    if (a.instructor && !b.instructor) return -1;
    if (!a.instructor && b.instructor) return 1;
    // 最后按主管排序
    if (a.director && !b.director) return -1;
    if (!a.director && b.director) return 1;
    return 0;
  });
});

// 统计数据
const totalControllers = computed(() => controllers.value.length);
const activeControllers = computed(
  () => controllers.value.filter((c) => c.status).length,
);
const instructors = computed(
  () => controllers.value.filter((c) => c.instructor).length,
);
const directors = computed(
  () => controllers.value.filter((c) => c.director).length,
);
const homeControllers = computed(
  () => controllers.value.filter((c) => c.home).length,
);

// 不能修改自己的状态。
//
// An inactive member used to be unmodifiable too, which locked the door from
// the inside: setting `status` back to true is exactly how someone is
// reinstated, so nobody could ever be brought back. Self is the only gate.
function isSelf(controller: Division): boolean {
  return controller.id.toString() === props.sessionUserId;
}

function openManagePanel(controller: Division) {
  // The row's button is already disabled (with the reason rendered beside it)
  // when this fails, so there is nothing to announce here.
  if (isSelf(controller)) return;

  selectedController.value = controller;
  editingController.value = { ...controller };
  saveError.value = null;
  isManagePanelOpen.value = true;
}

function closeManagePanel() {
  isManagePanelOpen.value = false;
  selectedController.value = null;
  editingController.value = null;
  saveError.value = null;
}

async function handleSaveChanges() {
  if (!editingController.value || !selectedController.value) return;

  saving.value = true;
  saveError.value = null;
  try {
    // `{region, flags}`，不是把标志摊平在顶层。
    //
    // can-api 解的是 `{region int, flags map[string]bool}`（internal/api/super.go
    // 的 rosterUpdateRequest）；摊平的请求体解出来 flags 为空，直接 400
    // `noChanges`，于是这个对话框的每一次保存都失败。
    //
    // region 也不是可省的：`division` 的唯一键是 (id, region)，UPDATE 的
    // WHERE 两个都要，否则定位不到跨分区成员的哪一行。它就在编辑中的这行上。
    //
    // 只发这六个：instructor / director 要 ADM 才能写，home 任何路径都不可写
    // ——入籍是单向的，转籍是另一条路。
    const updateData = {
      region: editingController.value.region,
      flags: {
        status: editingController.value.status,
        del: editingController.value.del,
        gnd: editingController.value.gnd,
        app: editingController.value.app,
        twr: editingController.value.twr,
        ctr: editingController.value.ctr,
      },
    };

    const response = await apiFetch(
      `/api/v1/super/roster/${selectedController.value.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      },
    );

    const result = await response.json();

    if (response.ok && result.status === 200) {
      // 服务端答的是 `{updated: true}`，不是更新后的那一行 —— 这里从前把它
      // 直接塞回表格，那一行就变成一个只有 `updated` 字段的对象，当场显示空白。
      await loadRoster();
      closeManagePanel();
    } else {
      // 错误信封是 {error, message}；`message` 是给人看的那句
      // （noAuthority / forbidden / invalidFlag 各不相同）。
      saveError.value = `${t("saveError")}: ${result.message || result.error || t("unknownError")}`;
    }
  } catch (err) {
    console.error("Error saving changes:", err);
    saveError.value = `${t("saveError")}: ${t("networkError")}`;
  } finally {
    saving.value = false;
  }
}

function getPermissionBadges(controller: Division) {
  const permissions = [
    { key: "del", label: "DEL", active: controller.del },
    { key: "gnd", label: "GND", active: controller.gnd },
    { key: "twr", label: "TWR", active: controller.twr },
    { key: "app", label: "APP", active: controller.app },
    { key: "ctr", label: "CTR", active: controller.ctr },
  ];

  return permissions.filter((perm) => perm.active);
}

// Locale-less, like every other panel in the app — these were pinned to
// "zh-CN", so an en-us or ja-jp instructor read Chinese-formatted dates here
// and nowhere else.
function formatDate(d: string) {
  return new Date(d).toLocaleDateString();
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString();
}

// The five control positions render as an identical labelled switch, so the
// panel builds them from a list instead of five copy-pasted blocks.
const controlPositions = computed(
  () =>
    [
      { key: "del", label: t("delPermission") },
      { key: "gnd", label: t("gndPermission") },
      { key: "twr", label: t("twrPermission") },
      { key: "app", label: t("appPermission") },
      { key: "ctr", label: t("ctrPermission") },
    ] as const,
);

// Instructor / director / home are granted through a formal process and are
// read-only here — one shape for all three.
const grantedFlags = computed(
  () =>
    [
      {
        key: "instructor",
        label: t("instructorPermission"),
        variant: "success",
        icon: "academicCap",
      },
      {
        key: "director",
        label: t("directorPermission"),
        variant: "warning",
        icon: "star",
      },
      {
        key: "home",
        label: t("homePermission"),
        variant: "info",
        icon: "home",
      },
    ] as const,
);

// UI: table columns (additive, presentation-only)
const columns = computed(() => [
  { key: "id", label: t("asnId") },
  { key: "status", label: t("status") },
  { key: "region", label: t("region") },
  { key: "permissions", label: t("controlPermissions") },
  { key: "tags", label: t("specialTags") },
  { key: "updatedAt", label: t("updateTime") },
  { key: "actions", label: t("actions") },
]);

// UI: filter options (additive, presentation-only)
const statusOptions = computed(() => [
  { value: "all", label: t("allStatus") },
  { value: "active", label: t("statusActive") },
  { value: "inactive", label: t("statusInactive") },
]);
const permissionOptions = computed(() => [
  { value: "all", label: t("allPermissions") },
  { value: "instructor", label: t("permissionInstructor") },
  { value: "director", label: t("permissionDirector") },
]);
</script>

<template>
  <!-- Loading -->
  <!-- Header, then the five summary tiles, then the roster table — the page's
       real shape, so nothing jumps when the data lands. -->
  <template v-if="loading">
    <Skeleton variant="stats" :count="5" header />
    <Skeleton variant="table" :count="8" class="mt-6" />
  </template>

  <!-- Error. The heading was a hardcoded Chinese string regardless of locale. -->
  <AlertBox v-else-if="error" variant="danger" :title="t('loadingError')">
    {{ error }}
  </AlertBox>

  <!-- Content -->
  <div v-else class="space-y-6">
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="shieldCheck"
      flush
    />

    <!-- Summary Stats -->
    <div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
      <StatCard
        :label="t('totalControllers')"
        :value="totalControllers"
        icon="users"
        accent="info"
      />
      <StatCard
        :label="t('activeCount')"
        :value="activeControllers"
        icon="checkCircle"
        accent="success"
      />
      <StatCard
        :label="t('instructorCount')"
        :value="instructors"
        icon="academicCap"
        accent="info"
      />
      <StatCard
        :label="t('directorCount')"
        :value="directors"
        icon="star"
        accent="warning"
      />
      <StatCard
        :label="t('homeCount')"
        :value="homeControllers"
        icon="home"
        accent="neutral"
      />
    </div>

    <!-- Search and Filter -->
    <Card>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Input type="text" :placeholder="t('searchId')" v-model="searchTerm">
          <template #leadingIcon>
            <Icon name="magnifyingGlass" class="size-5" />
          </template>
        </Input>

        <Select v-model="statusFilter" :options="statusOptions" />

        <Select v-model="permissionFilter" :options="permissionOptions" />

        <div class="flex items-center text-sm text-muted">
          {{ t("showing") }} {{ filteredControllers.length }} {{ t("of") }}
          {{ totalControllers }} {{ t("controllersCount") }}
        </div>
      </div>
    </Card>

    <!-- Controllers List -->
    <Card padding="none">
      <template #header>
        <h2 class="flex items-center gap-3 text-xl font-semibold text-ink">
          <Icon name="buildingOffice" class="size-6 shrink-0 text-can" />
          {{ t("regionalRoster") }}
          <Badge variant="neutral" size="sm">
            {{ filteredControllers.length }}
          </Badge>
        </h2>
      </template>

      <div class="p-4 sm:p-6">
        <DataTable :columns="columns" :rows="sortedControllers" row-key="id">
          <template #empty>
            <EmptyState
              icon="users"
              :title="t('noControllersFound')"
              :description="t('adjustFilters')"
            />
          </template>

          <template #cell-id="{ row }">
            <span :class="['font-medium', !row.status ? 'opacity-60' : '']">
              {{ row.id }}
            </span>
          </template>

          <template #cell-status="{ row }">
            <span :class="!row.status ? 'opacity-60' : ''">
              <Badge v-if="row.status" variant="success" size="sm">
                <Icon name="checkCircle" class="size-3.5" />
                {{ t("statusActive") }}
              </Badge>
              <Badge v-else variant="neutral" size="sm">
                <Icon name="xCircle" class="size-3.5" />
                {{ t("statusInactive") }}
              </Badge>
            </span>
          </template>

          <template #cell-region="{ row }">
            <span :class="!row.status ? 'opacity-60' : ''">
              {{ divisionTrans(row.region.toString()) }}
            </span>
          </template>

          <template #cell-permissions="{ row }">
            <div
              :class="['flex flex-wrap gap-1', !row.status ? 'opacity-60' : '']"
            >
              <Badge
                v-for="perm in getPermissionBadges(row)"
                :key="perm.key"
                variant="info"
                size="sm"
              >
                {{ perm.label }}
              </Badge>
            </div>
          </template>

          <template #cell-tags="{ row }">
            <div
              :class="['flex flex-wrap gap-1', !row.status ? 'opacity-60' : '']"
            >
              <Badge v-if="row.instructor" variant="info" size="sm">
                <Icon name="academicCap" class="size-3.5" />
                {{ t("instructor") }}
              </Badge>
              <Badge v-if="row.director" variant="warning" size="sm">
                <Icon name="star" class="size-3.5" />
                {{ t("director") }}
              </Badge>
              <Badge v-if="row.home" variant="info" size="sm">
                <Icon name="home" class="size-3.5" />
                {{ t("home") }}
              </Badge>
            </div>
          </template>

          <template #cell-updatedAt="{ row }">
            <span :class="['text-muted', !row.status ? 'opacity-60' : '']">
              {{ formatDate(row.updatedAt) }}
            </span>
          </template>

          <template #cell-actions="{ row }">
            <div class="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                :disabled="isSelf(row)"
                :title="isSelf(row) ? t('cannotModifySelf') : t('manage')"
                @click="openManagePanel(row)"
              >
                <template #icon>
                  <Icon
                    :name="isSelf(row) ? 'exclamationTriangle' : 'pencilSquare'"
                    class="size-4"
                  />
                </template>
                {{ t("manage") }}
              </Button>
              <span v-if="isSelf(row)" class="text-xs text-muted">
                ({{ t("cannotModifySelf") }})
              </span>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- Management Panel Modal -->
    <div
      v-if="isManagePanelOpen"
      class="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="manageTitleId"
    >
      <div
        class="absolute inset-0 bg-gray-900/70 backdrop-blur-sm"
        @click="closeManagePanel"
      ></div>

      <!-- One scroll container, not two. The panel used to nest a
           `max-h-96 overflow-y-auto` body inside a `max-h-[90dvh]
           overflow-y-auto` shell, so on a laptop the form scrolled inside a
           384px well while the shell it sat in had room to spare — and on a
           phone the two fought each other. Now the shell is a flex column
           whose header and footer are fixed and whose body is the only thing
           that scrolls. -->
      <div class="absolute inset-0 flex items-center justify-center p-4">
        <div
          ref="managePanel"
          tabindex="-1"
          class="relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-card border border-subtle bg-surface shadow-popover"
        >
          <div class="shrink-0 border-b border-subtle px-4 py-4 sm:px-6">
            <h2
              :id="manageTitleId"
              class="flex items-center gap-3 text-lg font-semibold text-ink"
            >
              <Icon name="cog6Tooth" class="size-6 shrink-0 text-can" />
              <span class="min-w-0 truncate">
                {{ t("manageController") }} — {{ selectedController?.id ?? "" }}
              </span>
            </h2>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div v-if="editingController" class="space-y-6">
              <!-- Basic Info -->
              <section>
                <h3
                  class="mb-3 text-sm font-semibold uppercase tracking-wider text-faint"
                >
                  {{ t("basicInfo") }}
                </h3>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    type="text"
                    label="CAN ID"
                    :model-value="editingController.id"
                    disabled
                  />
                  <Input
                    type="text"
                    :label="t('region')"
                    :model-value="
                      divisionTrans(editingController.region.toString())
                    "
                    disabled
                  />
                </div>
              </section>

              <!-- Status -->
              <section>
                <h3
                  class="mb-3 text-sm font-semibold uppercase tracking-wider text-faint"
                >
                  {{ t("statusManagement") }}
                </h3>
                <Toggle
                  v-model="editingController.status"
                  :label="t('controllerStatus')"
                  :description="t('controllerStatusDesc')"
                />
              </section>

              <!-- Special Permissions — read-only, granted elsewhere. -->
              <section>
                <h3
                  class="mb-3 text-sm font-semibold uppercase tracking-wider text-faint"
                >
                  {{ t("specialPermissions") }}
                </h3>
                <div class="space-y-4">
                  <div
                    v-for="flag in grantedFlags"
                    :key="flag.key"
                    class="flex items-start justify-between gap-4"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-ink">
                        {{ flag.label }}
                      </p>
                      <p class="mt-0.5 text-sm text-muted">
                        {{ t("requiresFormalProcess") }}
                      </p>
                    </div>
                    <Badge
                      v-if="editingController[flag.key]"
                      :variant="flag.variant"
                    >
                      <Icon :name="flag.icon" class="size-4" />
                      {{ t("authorized") }}
                    </Badge>
                    <Badge v-else variant="neutral">
                      {{ t("unauthorized") }}
                    </Badge>
                  </div>
                </div>
              </section>

              <!-- Control Permissions -->
              <section>
                <h3
                  class="mb-3 text-sm font-semibold uppercase tracking-wider text-faint"
                >
                  {{ t("controlPermissions") }}
                </h3>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Toggle
                    v-for="position in controlPositions"
                    :key="position.key"
                    v-model="editingController[position.key]"
                    :label="position.label"
                  />
                </div>
              </section>

              <!-- Timestamps -->
              <section>
                <h3
                  class="mb-3 text-sm font-semibold uppercase tracking-wider text-faint"
                >
                  {{ t("timeInfo") }}
                </h3>
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    type="text"
                    :label="t('createdAt')"
                    :model-value="formatDateTime(editingController.createdAt)"
                    disabled
                  />
                  <Input
                    type="text"
                    :label="t('lastUpdated')"
                    :model-value="formatDateTime(editingController.updatedAt)"
                    disabled
                  />
                </div>
              </section>
            </div>

            <Skeleton
              v-else
              variant="text"
              :count="4"
              :label="t('loadingControllerData')"
            />
          </div>

          <div
            class="shrink-0 space-y-3 border-t border-subtle px-4 py-4 sm:px-6"
          >
            <AlertBox v-if="saveError" variant="danger">
              {{ saveError }}
            </AlertBox>
            <div class="flex justify-end gap-3">
              <Button variant="secondary" @click="closeManagePanel">
                {{ t("cancel") }}
              </Button>
              <Button
                variant="primary"
                :disabled="saving"
                :loading="saving"
                @click="handleSaveChanges"
              >
                {{ saving ? t("saving") : t("saveChanges") }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
