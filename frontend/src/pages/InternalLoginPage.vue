<script setup lang="ts">
import { ref } from 'vue'
import { HttpError } from '../services/http'
import { authService } from '../services/auth'
import type { InternalUser } from '../types/domain'
import { AUTH_USER_STORAGE_KEY } from '../utils/core'

const emit = defineEmits<{ authenticated: [user: InternalUser] }>()
const mode = ref<'login' | 'register'>('login')
const userId = ref(localStorage.getItem(AUTH_USER_STORAGE_KEY) || '')
const displayName = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteKey = ref('')
const pending = ref(false)
const error = ref('')
const registeredId = ref('')

const continueAfterRegistration = () => window.location.reload()

const submit = async () => {
  error.value = ''
  if (mode.value === 'login' && !userId.value.trim()) { error.value = '请输入用户 ID。'; return }
  if (!password.value) { error.value = '请输入密码。'; return }
  if (mode.value === 'register' && password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致。'; return }
  if (mode.value === 'register' && !inviteKey.value) { error.value = '请输入项目负责人提供的注册邀请码。'; return }
  pending.value = true
  try {
    const result = mode.value === 'login'
      ? await authService.login(userId.value, password.value)
      : await authService.register(displayName.value, password.value, inviteKey.value)
    localStorage.setItem(AUTH_USER_STORAGE_KEY, result.user.id)
    if (mode.value === 'register') {
      registeredId.value = result.user.id
      return
    }
    emit('authenticated', result.user)
    window.location.reload()
  } catch (cause) {
    error.value = cause instanceof HttpError ? cause.message : '请求失败，请检查网络连接。'
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
      <h1 id="internal-login-title">{{ mode === 'login' ? '进入内部测试' : '注册标注账号' }}</h1>
      <p class="internal-login-lede">
        {{ mode === 'login' ? '使用注册成功后生成的用户 ID 和密码登录。用户 ID 是身份标识，每个账号的研究记录彼此隔离。' : '无需填写用户名。注册成功后会生成唯一用户 ID；请务必记住它，后续登录和反馈归属都使用这个 ID。' }}
      </p>
      <form @submit.prevent="submit">
        <label v-if="mode === 'login'"><span>用户 ID</span><input v-model="userId" autocomplete="username" maxlength="32" placeholder="例如 u-7k3m9p2c" /></label>
        <label v-if="mode === 'register'"><span>显示名称（可选）</span><input v-model="displayName" autocomplete="name" maxlength="80" placeholder="例如 张医生" /></label>
        <label><span>密码</span><input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="256" placeholder="至少 6 个字符" /></label>
        <label v-if="mode === 'register'"><span>确认密码</span><input v-model="confirmPassword" type="password" autocomplete="new-password" maxlength="256" /></label>
        <label v-if="mode === 'register'"><span>注册邀请码</span><input v-model="inviteKey" type="password" autocomplete="off" placeholder="由项目负责人提供" /></label>
        <p v-if="error" class="internal-login-error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="pending">{{ pending ? '处理中…' : mode === 'login' ? '进入工作台' : '注册并进入' }}</button>
      </form>
      <div v-if="registeredId" class="registration-success" role="status">
        <strong>注册成功</strong>
        <span>你的用户 ID 是</span>
        <code>{{ registeredId }}</code>
        <small>请把它记下来，后续反馈和研究记录都会归属于这个 ID。</small>
        <button type="button" @click="continueAfterRegistration">进入工作台</button>
      </div>
      <button class="mode-switch" type="button" @click="mode = mode === 'login' ? 'register' : 'login'; error = ''">
        {{ mode === 'login' ? '首次使用？注册账号' : '已有账号？返回登录' }}
      </button>
      <small>忘记用户 ID 或密码时，请联系项目管理员处理。请不要分享密码或注册邀请码。</small>
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
.internal-login button[type='submit'] { padding: 12px 16px; border: 0; border-radius: 8px; background: var(--jade, #317b6b); color: #fff; font-weight: 700; cursor: pointer; }
.internal-login button:disabled { cursor: wait; opacity: .62; }
.internal-login-error { margin: 0; color: #a43d36; font-size: 13px; }
.registration-success { display: grid; gap: 8px; margin-top: 18px; padding: 14px; border-radius: 10px; background: rgba(49, 123, 107, .1); color: var(--ink-soft, #56636f); }
.registration-success strong { color: var(--jade, #317b6b); }
.registration-success code { width: fit-content; padding: 5px 8px; border-radius: 5px; background: rgba(23, 37, 53, .08); color: var(--ink, #172535); font: 700 15px/1.2 var(--mono, monospace); letter-spacing: .08em; }
.registration-success button { justify-self: start; margin-top: 3px; padding: 8px 12px; border: 0; border-radius: 7px; background: var(--jade, #317b6b); color: #fff; cursor: pointer; }
.mode-switch { margin-top: 16px; border: 0; background: transparent; color: var(--jade, #317b6b); cursor: pointer; font: inherit; }
.internal-login small { display: block; margin-top: 22px; color: var(--ink-faint, #8a959b); line-height: 1.6; }
</style>
