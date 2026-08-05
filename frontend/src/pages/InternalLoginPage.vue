<script setup lang="ts">
import { ref } from 'vue'
import { HttpError } from '../services/http'
import { authService } from '../services/auth'
import type { InternalUser } from '../types/domain'
import { AUTH_USER_STORAGE_KEY } from '../utils/core'

const emit = defineEmits<{ authenticated: [user: InternalUser] }>()
const username = ref('')
const accessKey = ref('')
const pending = ref(false)
const error = ref('')

const submit = async () => {
  if (!username.value.trim() || !accessKey.value) {
    error.value = '请输入用户名和内部访问密钥。'
    return
  }
  pending.value = true
  error.value = ''
  try {
    const result = await authService.login(username.value, accessKey.value)
    localStorage.setItem(AUTH_USER_STORAGE_KEY, result.user.id)
    emit('authenticated', result.user)
    window.location.reload()
  } catch (cause) {
    error.value = cause instanceof HttpError ? cause.message : '登录失败，请检查网络连接。'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="internal-login">
    <section class="internal-login-card" aria-labelledby="internal-login-title">
      <div class="entry-brand"><span class="entry-mark">循</span><span>循医</span></div>
      <p class="internal-login-kicker">INTERNAL REVIEW</p>
      <h1 id="internal-login-title">进入内部测试</h1>
      <p class="internal-login-lede">请输入标注人员用户名和共享访问密钥。用户名用于区分研究记录。</p>
      <form @submit.prevent="submit">
        <label>
          <span>用户名</span>
          <input v-model="username" autocomplete="username" maxlength="64" placeholder="例如 annotator_01" />
        </label>
        <label>
          <span>内部访问密钥</span>
          <input v-model="accessKey" type="password" autocomplete="current-password" placeholder="由项目负责人提供" />
        </label>
        <p v-if="error" class="internal-login-error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="pending">{{ pending ? '验证中…' : '进入工作台' }}</button>
      </form>
      <small>仅供项目内部标注与反馈使用，请不要分享访问密钥。</small>
    </section>
  </main>
</template>

<style scoped>
.internal-login { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 20% 10%, rgba(61, 126, 112, .13), transparent 38%), var(--paper, #f6f7f3); }
.internal-login-card { width: min(100%, 420px); padding: 38px; border: 1px solid rgba(23, 37, 53, .14); border-radius: 18px; background: rgba(255, 255, 255, .84); box-shadow: 0 20px 60px rgba(25, 45, 58, .1); }
.internal-login-kicker { margin: 38px 0 9px; color: var(--jade, #317b6b); font: 600 11px/1.2 var(--mono, monospace); letter-spacing: .14em; }
.internal-login h1 { margin: 0; color: var(--ink, #172535); font: 700 30px/1.2 var(--serif, Georgia, serif); }
.internal-login-lede { color: var(--ink-soft, #56636f); line-height: 1.7; }
.internal-login form { display: grid; gap: 15px; margin-top: 26px; }
.internal-login label { display: grid; gap: 7px; color: var(--ink-soft, #56636f); font-size: 13px; }
.internal-login input { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid rgba(23, 37, 53, .18); border-radius: 8px; background: #fff; color: var(--ink, #172535); font: inherit; }
.internal-login button { padding: 12px 16px; border: 0; border-radius: 8px; background: var(--jade, #317b6b); color: #fff; font-weight: 700; cursor: pointer; }
.internal-login button:disabled { cursor: wait; opacity: .62; }
.internal-login-error { margin: 0; color: #a43d36; font-size: 13px; }
.internal-login small { display: block; margin-top: 22px; color: var(--ink-faint, #8a959b); line-height: 1.6; }
</style>
