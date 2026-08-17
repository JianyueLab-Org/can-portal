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
  useOverlay,
} from "@jianyuelab-org/can-ui";
import {
  ratingId,
  ratingTrans,
  divisionTrans,
  type RatingRef,
} from "@/lib/tools";
import { apiFetch } from "@/lib/canApi";

const props = defineProps<{
  messages: Record<string, unknown>;
  sessionUserId: string;
}>();
const t = createTranslator(props.messages);

// 定义等级信息接口
interface RatingInfo {
  id: number;
  short: string;
  long: string;
  chinese?: string;
}

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

interface User {
  username: string;
  name: string;
  email: string;
  // The expanded `{id, short, long, zh}` this route actually answers, not the
  // bare int the same response's `byRegion` carries. Read through `ratingId`:
  // arithmetic on the object silently produced "[object Object]1" as the
  // target rating and a NaN loop bound that emptied the rating picker.
  rating: RatingRef;
  emailVerified: string | null;
  createdAt: string;
  updatedAt: string;
  divisions: Division[];
}

interface PromoteData {
  /** Every region the signed-in instructor is active in, not just one. */
  regions: number[];
  users: User[];
}

const promoteData = ref<PromoteData | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
const searchTerm = ref("");
const ratingFilter = ref<string>("all");
const statusFilter = ref<string>("all");

// Modal states
const isPromoteModalOpen = ref(false);
// Escape to close, focus trapped in the dialog, page behind locked.
const promoteModal = useOverlay(isPromoteModalOpen);
// Without this the dialog announces as an unnamed "dialog".
const promoteTitleId = useId();
const selectedUser = ref<User | null>(null);
const selectedToRating = ref<number>(1);
const comment = ref("");
const submitting = ref(false);
// alert() blocks the page, ignores the theme and reads out of context to a
// screen reader; the rest of the app reports through AlertBox. `formError`
// stays inside the dialog next to the form that failed, `notice` lands on the
// page the dialog just closed over.
const formError = ref<string | null>(null);
const notice = ref<{ variant: "success" | "danger"; text: string } | null>(
  null,
);
/** 发起人自己的等级，见 onMounted —— 目标等级不得高于它。 */
const viewerRating = ref<number>(NaN);

onMounted(async () => {
  if (props.sessionUserId) {
    try {
      // 首先检查用户数据以验证权限
      const userResponse = await apiFetch(
        `/api/v1/pilot/${props.sessionUserId}`,
      );
      const userData = await userResponse.json();

      // 检查用户是否为教员（I1及以上）
      if (!userData.data || userData.data.user?.rating?.id < 8) {
        error.value = t("accessDeniedInstructor");
        loading.value = false;
        return;
      }
      // 记下来，因为服务端拒绝把任何人提到高于发起人自己的等级
      // （internal/api/super.go 的 `aboveYourOwn`）。目标等级下拉框以此封顶，
      // 否则一个 I1 教员会看到 I2/I3 两个选项，选了就是一记 403。
      viewerRating.value = ratingId(userData.data.user?.rating);

      const response = await apiFetch("/api/v1/super/promote");
      const result = await response.json();

      if (result.status === 200) {
        promoteData.value = result.data;
      } else {
        error.value = t("fetchUserDataError");
      }
    } catch (err) {
      error.value = t("fetchDataError");
      console.error("Error:", err);
    } finally {
      loading.value = false;
    }
  } else {
    loading.value = false;
  }
});

// 过滤用户数据
const filteredUsers = computed<User[]>(() => {
  return (
    promoteData.value?.users.filter((user) => {
      // 搜索过滤
      const searchMatch =
        user.username.toLowerCase().includes(searchTerm.value.toLowerCase()) ||
        user.name.toLowerCase().includes(searchTerm.value.toLowerCase());

      // 等级过滤
      let ratingMatch = true;
      if (ratingFilter.value !== "all") {
        ratingMatch = ratingId(user.rating) === parseInt(ratingFilter.value);
      }

      // 状态过滤
      let statusMatch = true;
      if (statusFilter.value === "active") {
        statusMatch = user.divisions.some((div) => div.status);
      } else if (statusFilter.value === "inactive") {
        statusMatch = !user.divisions.some((div) => div.status);
      }

      return searchMatch && ratingMatch && statusMatch;
    }) || []
  );
});

// 统计数据
/**
 * An instructor active in more than one division administers all of them, so
 * the heading names all of them. This read a single `region` off the payload,
 * back when the API picked one of the caller's division rows arbitrarily.
 */
const regionLabel = computed(() =>
  (promoteData.value?.regions ?? []).map(divisionTrans).join(" / "),
);

const totalUsers = computed(() => promoteData.value?.users.length || 0);
const eligibleUsers = computed(
  () =>
    promoteData.value?.users.filter((user) => {
      const rating = ratingId(user.rating);
      return rating >= 1 && rating < 10;
    }).length || 0,
);

// 处理晋升申请
const handlePromote = async () => {
  if (!selectedUser.value) return;

  submitting.value = true;
  try {
    const response = await apiFetch("/api/v1/super/promotions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      // 不发 `fromRating`：服务端不读它，起始等级是它自己从申请人当前的
      // rating 现取的（internal/store/roster.go 写的是 `target.Rating`）。
      // 这是对的 —— 这张列表可能已经陈旧，而客户端报来的起始等级会决定
      // 审批时那道「等级变过了」的一致性检查拿什么去比。
      body: JSON.stringify({
        applicant: selectedUser.value.username,
        toRating: selectedToRating.value,
        comment: comment.value.trim() || null,
      }),
    });

    const result = await response.json();

    if (response.ok && result.status === 200) {
      // 关闭模态框并重置状态
      isPromoteModalOpen.value = false;
      selectedUser.value = null;
      comment.value = "";
      notice.value = { variant: "success", text: t("promotionSuccess") };
    } else {
      // 错误信封是 {error, message}，没有 `status` —— 所以上面那个判断对任何
      // 失败都只是 undefined。`aboveYourOwn`、`noAuthority`、`notFound` 三种
      // 各要发起人做不同的事，把服务端的话原样带出来。
      formError.value = result.message || t("createPromotionFailed");
    }
  } catch (err) {
    console.error("Error creating promotion:", err);
    formError.value = t("createPromotionError");
  } finally {
    submitting.value = false;
  }
};

// 获取等级选项（从当前等级+1开始，最高到I3，且不高于发起人自己）
function getRatingOptions(currentRating: number) {
  const options: { id: number; short: string; long: string }[] = [];
  // I3 是这张表的上限，发起人自己的等级是服务端的上限，取两者更低的那个。
  // viewerRating 尚未读到时（NaN）只受 I3 约束，和从前一样。
  const ceiling = 10; // I3 - Advanced Instructor
  const maxRating = Number.isNaN(viewerRating.value)
    ? ceiling
    : Math.min(ceiling, viewerRating.value);
  for (let i = currentRating + 1; i <= maxRating; i++) {
    const rating = ratingTrans(i, "zh", "full") as RatingInfo | null;
    if (rating) {
      options.push({ id: i, short: rating.short, long: rating.long });
    }
  }
  return options;
}

function ratingShort(rating: RatingRef | null | undefined): string {
  const data = ratingTrans(ratingId(rating), "zh", "full") as RatingInfo | null;
  return data?.short || "Unknown";
}

function isUserActive(user: User): boolean {
  return user.divisions.some((div) => div.status);
}

function openPromoteModal(user: User) {
  selectedUser.value = user;
  selectedToRating.value = ratingId(user.rating) + 1;
  comment.value = "";
  formError.value = null;
  notice.value = null;
  isPromoteModalOpen.value = true;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString();
}

// 等级过滤选项
const ratingFilterOptions = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const selectedFromRatingLabel = computed(() =>
  selectedUser.value ? ratingShort(selectedUser.value.rating) : "",
);

const modalRatingOptions = computed(() =>
  selectedUser.value
    ? getRatingOptions(ratingId(selectedUser.value.rating))
    : [],
);

// Additive: DataTable column definitions for the user list.
const userColumns = [
  { key: "username", label: t("username") },
  { key: "name", label: t("name") },
  { key: "currentRating", label: t("currentRating") },
  { key: "emailVerified", label: t("emailVerified") },
  { key: "joinDate", label: t("joinDate") },
  { key: "actions", label: t("actions") },
];

// Additive: option arrays for BaseSelect filters.
const ratingSelectOptions = computed(() => [
  { value: "all", label: t("allRatings") },
  ...ratingFilterOptions.map((rating) => ({
    value: rating,
    label: ratingShort(rating),
  })),
]);

const statusSelectOptions = computed(() => [
  { value: "all", label: t("allStatuses") },
  { value: "active", label: t("statusActive") },
  { value: "inactive", label: t("statusInactive") },
]);
</script>

<template>
  <Skeleton v-if="loading" variant="table" :count="6" header />

  <AlertBox v-else-if="error" variant="danger" :title="t('loadingError')">
    {{ error }}
  </AlertBox>

  <div v-else class="space-y-6">
    <PageHeader
      :title="t('title')"
      :description="`${t('instructorOnlyDescription', { description: t('description') })} - ${regionLabel}`"
      icon="shieldCheck"
      flush
    />

    <AlertBox
      v-if="notice"
      :variant="notice.variant"
      dismissible
      @dismiss="notice = null"
    >
      {{ notice.text }}
    </AlertBox>

    <!-- Summary Stats -->
    <div class="grid grid-cols-2 gap-3 sm:gap-4">
      <StatCard
        :label="t('totalUsers')"
        :value="totalUsers"
        icon="users"
        accent="info"
      />
      <StatCard
        :label="t('eligibleUsers')"
        :value="eligibleUsers"
        icon="checkCircle"
        accent="success"
      />
    </div>

    <!-- Search and Filter -->
    <Card>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
        <Input v-model="searchTerm" :placeholder="t('searchUser')">
          <template #leadingIcon>
            <!-- MagnifyingGlassIcon -->
            <Icon name="magnifyingGlass" class="size-5" />
          </template>
        </Input>

        <Select v-model="ratingFilter" :options="ratingSelectOptions" />

        <Select v-model="statusFilter" :options="statusSelectOptions" />

        <div class="text-sm text-muted">
          {{ t("showingUsers", { count: filteredUsers.length }) }}
        </div>
      </div>
    </Card>

    <!-- Users List -->
    <Card padding="none">
      <template #header>
        <h2 class="flex items-center gap-3 text-xl font-semibold text-ink">
          <Icon name="academicCap" class="size-6 shrink-0 text-can" />
          {{ t("userList") }}
          <Badge variant="neutral" size="sm">
            {{ filteredUsers.length }}
          </Badge>
        </h2>
      </template>

      <div class="p-4 sm:p-6">
        <DataTable
          :columns="userColumns"
          :rows="filteredUsers"
          row-key="username"
        >
          <template #empty>
            <EmptyState
              icon="users"
              :title="t('noUsersFound')"
              :description="t('adjustFilters')"
            />
          </template>

          <template #cell-username="{ row }">
            <div
              :class="[
                'text-sm font-medium text-ink',
                !isUserActive(row) ? 'opacity-60' : '',
              ]"
            >
              {{ row.username }}
            </div>
          </template>

          <template #cell-name="{ row }">
            <div
              :class="[
                'text-sm text-ink',
                !isUserActive(row) ? 'opacity-60' : '',
              ]"
            >
              {{ row.name }}
            </div>
          </template>

          <template #cell-currentRating="{ row }">
            <Badge
              size="sm"
              :class="!isUserActive(row) ? 'opacity-60' : ''"
              :variant="
                ratingId(row.rating) >= 5
                  ? 'info'
                  : ratingId(row.rating) >= 2
                    ? 'success'
                    : 'neutral'
              "
            >
              {{ ratingShort(row.rating) }}
            </Badge>
          </template>

          <template #cell-emailVerified="{ row }">
            <Badge
              v-if="row.emailVerified"
              variant="success"
              size="sm"
              :class="!isUserActive(row) ? 'opacity-60' : ''"
            >
              <!-- CheckCircleIcon -->
              <Icon name="checkCircle" class="size-3.5" />
              {{ t("verified") }}
            </Badge>
            <Badge
              v-else
              variant="danger"
              size="sm"
              :class="!isUserActive(row) ? 'opacity-60' : ''"
            >
              <!-- XCircleIcon -->
              <Icon name="xCircle" class="size-3.5" />
              {{ t("notVerified") }}
            </Badge>
          </template>

          <template #cell-joinDate="{ row }">
            <span
              :class="[
                'text-sm text-muted',
                !isUserActive(row) ? 'opacity-60' : '',
              ]"
            >
              {{ formatDate(row.createdAt) }}
            </span>
          </template>

          <template #cell-actions="{ row }">
            <!-- 最高只能申请到I3 (等级10) -->
            <Button
              v-if="ratingId(row.rating) >= 1 && ratingId(row.rating) < 10"
              size="sm"
              @click="openPromoteModal(row)"
            >
              <template #icon>
                <!-- PlusIcon -->
                <Icon name="plus" class="size-4" />
              </template>
              {{ t("promoteUser") }}
            </Button>
            <span v-if="ratingId(row.rating) >= 10" class="text-sm text-muted">
              {{ t("maxLevelReached") }}
            </span>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- Promote Modal -->
    <div
      v-if="isPromoteModalOpen"
      class="relative z-50"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="promoteTitleId"
    >
      <div
        class="animate-overlay-in fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
        @click="isPromoteModalOpen = false"
      ></div>
      <div class="fixed inset-0 z-10 overflow-y-auto">
        <div
          class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
        >
          <div
            ref="promoteModal"
            tabindex="-1"
            class="animate-panel-in relative overflow-hidden rounded-xl bg-surface px-4 pb-4 pt-5 text-left shadow-xl sm:my-8 sm:w-full sm:max-w-lg sm:p-6"
          >
            <div>
              <div
                class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-info-bg"
              >
                <!-- StarIcon -->
                <Icon name="star" class="size-6 text-can" />
              </div>
              <div class="mt-3 text-center sm:mt-5">
                <h3
                  :id="promoteTitleId"
                  class="text-base font-semibold leading-6 text-ink"
                >
                  {{ t("createPromotionRequest") }}
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-muted">
                    {{
                      t("createPromotionForUser", {
                        name: selectedUser?.name || "",
                        username: selectedUser?.username || "",
                      })
                    }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-5 space-y-4">
              <Input
                :label="t('selectFromRating')"
                disabled
                :model-value="selectedFromRatingLabel"
              />

              <div>
                <label class="block text-sm font-medium text-ink">
                  {{ t("selectToRating") }}
                </label>
                <select v-model.number="selectedToRating" class="input mt-2">
                  <option
                    v-for="option in modalRatingOptions"
                    :key="option.id"
                    :value="option.id"
                  >
                    {{ option.short }} - {{ option.long }}
                  </option>
                </select>
              </div>

              <div>
                <label class="block text-sm font-medium text-ink">
                  {{ t("comment") }}
                </label>
                <textarea
                  :rows="4"
                  v-model="comment"
                  :placeholder="t('commentPlaceholder')"
                  class="input mt-2"
                ></textarea>
              </div>
            </div>

            <AlertBox v-if="formError" variant="danger" class="mt-5">
              {{ formError }}
            </AlertBox>

            <div
              class="mt-5 sm:mt-6 sm:grid sm:grid-flow-row-dense sm:grid-cols-2 sm:gap-3"
            >
              <Button
                type="button"
                block
                :loading="submitting"
                :disabled="submitting"
                class="sm:col-start-2"
                @click="handlePromote"
              >
                {{ submitting ? t("submitting") : t("submit") }}
              </Button>
              <Button
                type="button"
                variant="secondary"
                block
                class="mt-3 sm:col-start-1 sm:mt-0"
                @click="isPromoteModalOpen = false"
              >
                {{ t("cancel") }}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
