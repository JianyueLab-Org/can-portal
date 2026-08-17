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
import { ratingId, ratingTrans, type RatingRef } from "@/lib/tools";
import { apiFetch, unwrapList } from "@/lib/canApi";

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

interface Promotion {
  id: number;
  applicant: string;
  instructor: string;
  // `promotion.fromRating`/`toRating` are plain ints in the table, but the
  // route renders them through can-api's `renderRating` and answers the
  // expanded object. Typed as either and read through `ratingId`.
  fromRating: RatingRef;
  toRating: RatingRef;
  status: number;
  comment: string | null;
  createdDate: string;
  updateDate: string;
}

const promotions = ref<Promotion[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const searchTerm = ref("");
const statusFilter = ref<string>("all");

// Modal states
const isApprovalModalOpen = ref(false);
// Escape to close, focus trapped in the dialog, page behind locked.
const approvalModal = useOverlay(isApprovalModalOpen);
// Without this the dialog announces as an unnamed "dialog".
const approvalTitleId = useId();
const selectedPromotion = ref<Promotion | null>(null);
const approvalComment = ref("");
const approvalAction = ref<"approve" | "reject">("approve");
const submitting = ref(false);
// See SuperPromote: alert() blocks, ignores the theme and reads out of
// context. `formError` stays in the dialog, `notice` lands on the page behind.
const formError = ref<string | null>(null);
const notice = ref<{ variant: "success" | "danger"; text: string } | null>(
  null,
);

function ratingShort(value: RatingRef | null | undefined): string {
  return (
    (ratingTrans(ratingId(value), "zh", "full") as RatingInfo | null)?.short ||
    "Unknown"
  );
}

// 模态框消息中使用的简称（找不到时回退为空字符串，与源码一致）
function ratingShortOrEmpty(value: RatingRef | null | undefined): string {
  return (
    (ratingTrans(ratingId(value), "zh", "full") as RatingInfo | null)?.short ||
    ""
  );
}

onMounted(async () => {
  if (props.sessionUserId) {
    try {
      // 首先检查用户数据以验证权限
      const userResponse = await apiFetch(
        `/api/v1/pilot/${props.sessionUserId}`,
      );
      const userData = await userResponse.json();

      // 检查用户是否为 ADM (rating 12)
      if (!userData.data || userData.data.user?.rating?.id !== 12) {
        error.value = t("accessDeniedAdm");
        loading.value = false;
        return;
      }

      const response = await apiFetch("/api/v1/super/promotions");
      const result = await response.json();

      if (result.status === 200) {
        promotions.value = unwrapList<Promotion>(result.data, "promotions");
      } else {
        error.value = t("fetchPromotionDataError");
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

// 过滤数据
const filteredPromotions = computed(() =>
  promotions.value.filter((promotion) => {
    // 搜索过滤
    const searchMatch =
      promotion.applicant
        .toLowerCase()
        .includes(searchTerm.value.toLowerCase()) ||
      promotion.instructor
        .toLowerCase()
        .includes(searchTerm.value.toLowerCase());

    // 状态过滤
    let statusMatch = true;
    if (statusFilter.value === "pending") statusMatch = promotion.status === 0;
    if (statusFilter.value === "approved") statusMatch = promotion.status === 1;
    if (statusFilter.value === "rejected") statusMatch = promotion.status === 2;

    return searchMatch && statusMatch;
  }),
);

// 统计数据
const totalPromotions = computed(() => promotions.value.length);
const pendingPromotions = computed(
  () => promotions.value.filter((p) => p.status === 0).length,
);
const approvedPromotions = computed(
  () => promotions.value.filter((p) => p.status === 1).length,
);
const rejectedPromotions = computed(
  () => promotions.value.filter((p) => p.status === 2).length,
);

function openApprovalModal(promotion: Promotion, action: "approve" | "reject") {
  selectedPromotion.value = promotion;
  approvalAction.value = action;
  approvalComment.value = "";
  formError.value = null;
  notice.value = null;
  isApprovalModalOpen.value = true;
}

// 处理审批操作
async function handleApproval() {
  if (!selectedPromotion.value) return;

  submitting.value = true;
  try {
    const response = await apiFetch(
      `/api/v1/super/promotions/${selectedPromotion.value.id}`,
      {
        // POST，不是 PATCH。这条是审批席上唯一一条 POST 的 `{id}` 路由 ——
        // 隔壁 roster / activity / prize / feedback 全是 PATCH，所以它看起来
        // 像笔误，而 can-api 上注册的就是 `POST /api/v1/super/promotions/{id}`
        // （internal/api/server.go）。改回 PATCH 会得到 405，而且因为下面只看
        // `result.status`、不看 HTTP 状态码，405 的响应体没有 status 字段，
        // 界面会安静地报一句通用失败。
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        // `approve`，一个布尔，不是 `action: "approve" | "reject"`。
        //
        // can-api 解的是 `{approve bool, comment string}`（internal/api/super.go
        // 的 decisionRequest）。发 `action` 不会报错 —— 多余的键被忽略，`Approve`
        // 取 Go 的零值 `false` —— 于是**每一次「批准」都被写成拒绝**，而下面看到
        // 200 就报成功。这是静默写错数据，不是功能失效：审批人看到绿色提示，
        // 申请人的等级没动，队列里那条变成 rejected。
        //
        // 批准即晋升 — the server applies the rating as part of approving,
        // so there is no longer a flag here deciding whether it takes effect.
        body: JSON.stringify({
          approve: approvalAction.value === "approve",
          comment: approvalComment.value.trim() || null,
        }),
      },
    );

    const result = await response.json();

    if (response.ok && result.status === 200) {
      // 关闭模态框并重置状态
      isApprovalModalOpen.value = false;
      selectedPromotion.value = null;
      approvalComment.value = "";
      notice.value = { variant: "success", text: t("approvalSuccess") };

      // 刷新数据
      const refreshResponse = await apiFetch("/api/v1/super/promotions");
      const refreshResult = await refreshResponse.json();
      if (refreshResult.status === 200) {
        promotions.value = unwrapList<Promotion>(
          refreshResult.data,
          "promotions",
        );
      }
    } else {
      // 三种冲突各有各的处置方式，而错误信封是 {error, message} —— 没有
      // `status` 字段，所以上面的 `result.status === 200` 对任何一种都只是
      // undefined。全渲染成同一句「审批失败」，审批人只会反复点同一个按钮：
      //   404 notFound    该申请没了
      //   409 settled     已经审批过
      //   409 ratingMoved 申请人的等级在此期间变过，要按当前等级重新发起
      formError.value = result.message || t("approvalError");
    }
  } catch (err) {
    console.error("Error processing approval:", err);
    formError.value = t("approvalError");
  } finally {
    submitting.value = false;
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString();
}

// Additive presentational config (no logic change).
const columns = computed(() => [
  { key: "applicant", label: t("applicant") },
  { key: "instructor", label: t("instructor") },
  { key: "fromRating", label: t("fromRating") },
  { key: "toRating", label: t("toRating") },
  { key: "status", label: t("status") },
  { key: "createdDate", label: t("createdDate") },
  { key: "actions", label: t("actions") },
]);

const statusFilterOptions = computed(() => [
  { value: "all", label: t("allStatuses") },
  { value: "pending", label: t("statusPending") },
  { value: "approved", label: t("statusApproved") },
  { value: "rejected", label: t("statusRejected") },
]);
</script>

<template>
  <Skeleton v-if="loading" variant="table" :count="6" header />

  <AlertBox v-else-if="error" variant="danger" :title="t('loadingError')">
    {{ error }}
  </AlertBox>

  <div v-else class="space-y-6">
    <PageHeader
      :title="t('promotionApprovalTitle')"
      :description="t('adminOnlyDescription')"
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
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        :label="t('totalApplications')"
        :value="totalPromotions"
        icon="chartBar"
        accent="info"
      />
      <StatCard
        :label="t('pendingPromotions')"
        :value="pendingPromotions"
        icon="clock"
        accent="warning"
      />
      <StatCard
        :label="t('approvedApplications')"
        :value="approvedPromotions"
        icon="checkCircle"
        accent="success"
      />
      <StatCard
        :label="t('rejectedApplications')"
        :value="rejectedPromotions"
        icon="xMark"
        accent="danger"
      />
    </div>

    <!-- Search and Filter -->
    <Card>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input
          v-model="searchTerm"
          type="text"
          :placeholder="t('searchApplicantOrInstructor')"
        >
          <template #leadingIcon>
            <Icon name="magnifyingGlass" class="size-5" />
          </template>
        </Input>

        <Select v-model="statusFilter" :options="statusFilterOptions" />

        <div class="flex items-center text-sm text-muted">
          {{ t("showingApplicants", { count: filteredPromotions.length }) }}
        </div>
      </div>
    </Card>

    <!-- Promotions List -->
    <Card padding="md">
      <template #header>
        <h2 class="flex items-center gap-3 text-xl font-semibold text-ink">
          <Icon name="academicCap" class="size-6 shrink-0 text-can" />
          {{ t("promotionListTitle") }}
          <Badge variant="neutral">
            {{ filteredPromotions.length }}
          </Badge>
        </h2>
      </template>

      <DataTable :columns="columns" :rows="filteredPromotions" row-key="id">
        <template #empty>
          <EmptyState
            icon="inbox"
            :title="t('noPromotionsFound')"
            :description="t('adjustFilters')"
          />
        </template>

        <template #cell-applicant="{ row }">
          <span class="font-medium text-ink">{{ row.applicant }}</span>
        </template>
        <template #cell-instructor="{ row }">
          <span class="text-muted">{{ row.instructor }}</span>
        </template>
        <template #cell-fromRating="{ row }">
          <span class="text-muted">{{ ratingShort(row.fromRating) }}</span>
        </template>
        <template #cell-toRating="{ row }">
          <span class="text-muted">{{ ratingShort(row.toRating) }}</span>
        </template>
        <template #cell-status="{ row }">
          <Badge
            :variant="
              row.status === 0
                ? 'warning'
                : row.status === 1
                  ? 'success'
                  : 'danger'
            "
          >
            {{
              row.status === 0
                ? t("statusPending")
                : row.status === 1
                  ? t("statusApproved")
                  : t("statusRejected")
            }}
          </Badge>
        </template>
        <template #cell-createdDate="{ row }">
          <span class="text-muted">{{ formatDate(row.createdDate) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div v-if="row.status === 0" class="flex space-x-2">
            <Button
              variant="primary"
              size="sm"
              @click="openApprovalModal(row, 'approve')"
            >
              <template #icon>
                <Icon name="checkCircle" class="size-3.5" />
              </template>
              {{ t("approve") }}
            </Button>
            <Button
              variant="danger"
              size="sm"
              @click="openApprovalModal(row, 'reject')"
            >
              <template #icon>
                <Icon name="xCircle" class="size-3.5" />
              </template>
              {{ t("reject") }}
            </Button>
          </div>
          <span v-if="row.status !== 0" class="text-xs text-faint">
            {{ t("processed") }}
          </span>
        </template>
      </DataTable>
    </Card>

    <!-- Approval Modal -->
    <div
      v-if="isApprovalModalOpen"
      class="relative z-50"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="approvalTitleId"
    >
      <div
        class="animate-overlay-in fixed inset-0 bg-gray-900/60 backdrop-blur-sm"
        @click="isApprovalModalOpen = false"
      ></div>
      <div class="fixed inset-0 z-10 overflow-y-auto">
        <div
          class="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0"
        >
          <div
            ref="approvalModal"
            tabindex="-1"
            class="animate-panel-in relative overflow-hidden rounded-lg bg-surface px-4 pb-4 pt-5 text-left shadow-xl sm:my-8 sm:w-full sm:max-w-lg sm:p-6"
          >
            <div>
              <div
                :class="[
                  'mx-auto flex h-12 w-12 items-center justify-center rounded-full',
                  approvalAction === 'approve'
                    ? 'bg-success-bg text-success-fg'
                    : 'bg-danger-bg text-danger-fg',
                ]"
              >
                <Icon
                  :name="
                    approvalAction === 'approve' ? 'checkCircle' : 'xCircle'
                  "
                  class="size-6"
                />
              </div>
              <div class="mt-3 text-center sm:mt-5">
                <h3
                  :id="approvalTitleId"
                  class="text-base font-semibold leading-6 text-ink"
                >
                  {{
                    approvalAction === "approve"
                      ? t("confirmApprove")
                      : t("confirmReject")
                  }}
                </h3>
                <div class="mt-2">
                  <p class="text-sm text-muted">
                    {{
                      approvalAction === "approve"
                        ? t("confirmApproveMessage", {
                            user: selectedPromotion?.applicant || "",
                            from: ratingShortOrEmpty(
                              selectedPromotion?.fromRating,
                            ),
                            to: ratingShortOrEmpty(selectedPromotion?.toRating),
                          })
                        : t("confirmRejectMessage", {
                            user: selectedPromotion?.applicant || "",
                            from: ratingShortOrEmpty(
                              selectedPromotion?.fromRating,
                            ),
                            to: ratingShortOrEmpty(selectedPromotion?.toRating),
                          })
                    }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-5">
              <div>
                <label class="block text-sm font-medium text-ink">
                  {{ t("approvalComment") }}
                </label>
                <div class="mt-1">
                  <textarea
                    :rows="4"
                    v-model="approvalComment"
                    :placeholder="t('approvalCommentPlaceholder')"
                    class="input"
                  ></textarea>
                </div>
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
                :variant="approvalAction === 'approve' ? 'primary' : 'danger'"
                block
                :loading="submitting"
                :disabled="submitting"
                class="sm:col-start-2"
                @click="handleApproval"
              >
                {{
                  submitting
                    ? t("processing")
                    : approvalAction === "approve"
                      ? t("approve")
                      : t("reject")
                }}
              </Button>
              <Button
                type="button"
                variant="secondary"
                block
                class="mt-3 sm:col-start-1 sm:mt-0"
                @click="isApprovalModalOpen = false"
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
