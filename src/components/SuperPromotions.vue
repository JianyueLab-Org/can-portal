<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  Textarea,
} from "@jianyuelab-org/can-ui";
import { ratingId, ratingTrans, type RatingRef } from "@/lib/tools";
import { apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{
  messages: Record<string, unknown>;
  /** can-ui 自绘按钮（Dialog 的 ×、AlertBox 的关闭）的文案，见 `@/lib/chrome`。 */
  chrome: Record<string, unknown>;
  sessionUserId: string;
  viewerRating: number;
  // SUP (11) 起。页面按 `@/lib/config` 算好传进来 —— 那个模块读 process.env，
  // 不能进浏览器端的岛屿。
  canReview: boolean;
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
// The filters show no visible label — the placeholder and the "all …" option
// say what they are — so each carries a screen-reader-only one.
const searchId = useId();
const statusFilterId = useId();

// Modal states
const isApprovalModalOpen = ref(false);
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
      // 中间件已经挡过一次，这里只是不去请求一个必然 403 的队列。
      if (!props.canReview) {
        error.value = t("accessDeniedSup");
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

// can-api 的 DecidePromotion 拒绝两种：审批自己的申请，以及起止等级任一高于
// 审批人自己的。这里不给按钮，免得点下去才 403。
function canDecide(promotion: Promotion): boolean {
  if (promotion.applicant === props.sessionUserId) return false;
  return (
    Math.max(ratingId(promotion.fromRating), ratingId(promotion.toRating)) <=
    props.viewerRating
  );
}

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
      :messages="chrome"
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
        icon="xCircle"
        accent="danger"
      />
    </div>

    <!-- Search and Filter -->
    <Card>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <label :for="searchId" class="sr-only">{{
            t("searchApplicantOrInstructor")
          }}</label>
          <Input
            :id="searchId"
            v-model="searchTerm"
            type="search"
            :placeholder="t('searchApplicantOrInstructor')"
          >
            <template #leadingIcon>
              <Icon name="magnifyingGlass" class="size-5" />
            </template>
          </Input>
        </div>

        <div>
          <label :for="statusFilterId" class="sr-only">{{ t("status") }}</label>
          <Select
            :id="statusFilterId"
            v-model="statusFilter"
            :options="statusFilterOptions"
          />
        </div>

        <div
          class="tnum flex items-center text-sm text-muted"
          aria-live="polite"
        >
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
          <Badge variant="neutral" size="sm">
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
            size="sm"
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
          <div v-if="row.status === 0 && canDecide(row)" class="flex gap-2">
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
          <span v-else-if="row.status === 0" class="text-xs text-faint">—</span>
          <span v-else class="text-xs text-faint">
            {{ t("processed") }}
          </span>
        </template>
      </DataTable>
    </Card>

    <Dialog
      v-model:open="isApprovalModalOpen"
      :title="
        approvalAction === 'approve' ? t('confirmApprove') : t('confirmReject')
      "
      :description="
        t(
          approvalAction === 'approve'
            ? 'confirmApproveMessage'
            : 'confirmRejectMessage',
          {
            user: selectedPromotion?.applicant || '',
            from: ratingShortOrEmpty(selectedPromotion?.fromRating),
            to: ratingShortOrEmpty(selectedPromotion?.toRating),
          },
        )
      "
      :messages="chrome"
    >
      <div class="space-y-4">
        <Textarea
          v-model="approvalComment"
          :label="t('approvalComment')"
          :placeholder="t('approvalCommentPlaceholder')"
          :rows="4"
        />
        <AlertBox v-if="formError" variant="danger">
          {{ formError }}
        </AlertBox>
      </div>

      <template #footer>
        <Button variant="secondary" @click="isApprovalModalOpen = false">
          {{ t("cancel") }}
        </Button>
        <Button
          :variant="approvalAction === 'approve' ? 'primary' : 'danger'"
          :loading="submitting"
          :disabled="submitting"
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
      </template>
    </Dialog>
  </div>
</template>
