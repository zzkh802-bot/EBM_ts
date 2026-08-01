<script setup lang="ts">
import { computed } from 'vue'
import { usePatientIntakeStore } from '../../stores'
import { PATIENT_FREE_CHAT_TURN_LIMIT } from '../../types/domain'

defineProps<{ busy: boolean }>()
const emit = defineEmits<{ profile: []; newVisit: []; freeChat: [] }>()
const intake = usePatientIntakeStore()
const visibleSessions = computed(() => intake.sessions.filter((session) => session.mode === 'free_chat' || session.profileId === intake.activeProfile?.id))
const profileLine = computed(() => {
  const profile = intake.activeProfile
  if (!profile) return '尚未选择档案'
  return [profile.sex === 'female' ? '女' : profile.sex === 'male' ? '男' : '', profile.age === undefined ? '' : `${profile.age} 岁`].filter(Boolean).join(' · ') || '资料待补充'
})
</script>

<template>
  <aside class="patient-session-rail" aria-label="患者档案与会话">
    <button class="active-profile-card" type="button" :disabled="busy" @click="emit('profile')">
      <span>{{ intake.activeProfile?.name.slice(0, 1) || '?' }}</span>
      <span><strong>{{ intake.activeProfile?.name || '选择就诊档案' }}</strong><small>{{ profileLine }}</small></span>
      <em>切换</em>
    </button>
    <div class="patient-session-actions">
      <button type="button" :disabled="busy" @click="emit('newVisit')">＋ 新建就诊准备</button>
      <button type="button" :disabled="busy" @click="emit('freeChat')">自由问答 · {{ PATIENT_FREE_CHAT_TURN_LIMIT }}轮</button>
    </div>
    <section>
      <header>最近会话</header>
      <button v-for="session in visibleSessions" :key="session.id" class="patient-session-item" :class="{ active: session.id === intake.activeSessionId }" type="button" :disabled="busy" @click="intake.select(session.id)">
        <span>{{ session.mode === 'free_chat' ? '问答' : session.visitSummary ? '报告' : '准备' }}</span>
        <span><strong>{{ session.title }}</strong><small>{{ session.mode === 'free_chat' ? `${session.messages.filter(item => item.role === 'user' && !item.failed).length}/${PATIENT_FREE_CHAT_TURN_LIMIT} 轮 · 不记忆` : session.visitSummary ? '已生成就诊说明' : '继续补充信息' }}</small></span>
      </button>
    </section>
  </aside>
</template>
