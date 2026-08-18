<script setup lang="ts">
import { ref } from 'vue'
import { HttpError } from '../services/http'
import { authService } from '../services/auth'
import type { InternalUser } from '../types/domain'
import { AUTH_USER_STORAGE_KEY } from '../utils/core'

const emit = defineEmits<{ authenticated: [user: InternalUser] }>()
const mode = ref<'login' | 'register'>('login')
const usernameOrId = ref(localStorage.getItem(AUTH_USER_STORAGE_KEY) || '')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const inviteKey = ref('')
const pending = ref(false)
const error = ref('')
const registeredUsername = ref('')

const continueAfterRegistration = () => window.location.reload()

const submit = async () => {
  error.value = ''
  if (mode.value === 'login' && !usernameOrId.value.trim()) { error.value = '请输入用户名或用户 ID。'; return }
  if (mode.value === 'register' && !username.value.trim()) { error.value = '请输入用户名。'; return }
  if (!password.value) { error.value = '请输入密码。'; return }
  if (mode.value === 'register' && password.value !== confirmPassword.value) { error.value = '两次输入的密码不一致。'; return }
  if (mode.value === 'register' && !inviteKey.value) { error.value = '请输入项目负责人提供的注册邀请码。'; return }
  pending.value = true
  try {
    const result = mode.value === 'login'
      ? await authService.login(usernameOrId.value, password.value)
      : await authService.register(username.value, password.value, inviteKey.value)
    localStorage.setItem(AUTH_USER_STORAGE_KEY, result.user.username || usernameOrId.value || username.value)
    if (mode.value === 'register') {
      registeredUsername.value = result.user.username || username.value
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
        {{ mode === 'login' ? '使用用户名和密码登录。已有内部测试账号也可以继续使用原用户 ID 登录。' : '请创建唯一用户名；它将用于后续登录。系统生成的用户 ID 仅用于内部数据绑定。' }}
      </p>
      <form @submit.prevent="submit">
        <label v-if="mode === 'login'"><span>用户名或用户 ID</span><input v-model="usernameOrId" autocomplete="username" maxlength="32" placeholder="例如 wangli 或 u-7k3m9p2c" /></label>
        <label v-if="mode === 'register'"><span>用户名</span><input v-model="username" autocomplete="username" maxlength="32" placeholder="例如 wangli 或 张医生" /><small>3–32 个字符；支持中文、字母、数字、下划线、连字符和句点；不区分英文大小写。</small></label>
        <label><span>密码</span><input v-model="password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" maxlength="256" placeholder="至少 6 个字符" /></label>
        <label v-if="mode === 'register'"><span>确认密码</span><input v-model="confirmPassword" type="password" autocomplete="new-password" maxlength="256" /></label>
        <label v-if="mode === 'register'"><span>注册邀请码</span><input v-model="inviteKey" type="password" autocomplete="off" placeholder="由项目负责人提供" /></label>
        <p v-if="error" class="internal-login-error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="pending">{{ pending ? '处理中…' : mode === 'login' ? '进入工作台' : '注册并进入' }}</button>
      </form>
      <div v-if="registeredUsername" class="registration-success" role="status">
        <strong>注册成功</strong>
        <span>你的用户名是</span>
        <code>{{ registeredUsername }}</code>
        <small>请记住它；后续可直接用此用户名登录。</small>
        <button type="button" @click="continueAfterRegistration">进入工作台</button>
      </div>
      <button class="mode-switch" type="button" @click="mode = mode === 'login' ? 'register' : 'login'; error = ''">
        {{ mode === 'login' ? '首次使用？注册账号' : '已有账号？返回登录' }}
      </button>
      <small>忘记用户名或密码时，请联系项目管理员处理。已有账号仍可使用原用户 ID 登录。请不要分享密码或注册邀请码。</small>
    </section>
  </main>
</template>

<style scoped>
.internal-login { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 20% 10%, rgba(77, 117, 168, .13), transparent 38%), var(--paper, #eef3fb); }
.internal-login-card { width: min(100%, 420px); padding: 38px; border: 1px solid rgba(23, 37, 53, .14); border-radius: 18px; background: rgba(255, 255, 255, .84); box-shadow: 0 20px 60px rgba(25, 45, 58, .1); }
.internal-login-kicker { margin: 38px 0 9px; color: var(--jade, #3156c8); font: 600 11px/1.2 var(--mono, monospace); letter-spacing: .14em; }
.internal-login h1 { margin: 0; color: var(--ink, #172535); font: 700 30px/1.2 var(--serif, Georgia, serif); }
.internal-login-lede { color: var(--ink-soft, #56636f); line-height: 1.7; }
.internal-login form { display: grid; gap: 15px; margin-top: 26px; }
.internal-login label { display: grid; gap: 7px; color: var(--ink-soft, #56636f); font-size: 13px; }
.internal-login input { box-sizing: border-box; width: 100%; padding: 11px 12px; border: 1px solid rgba(23, 37, 53, .18); border-radius: 8px; background: #fff; color: var(--ink, #172535); font: inherit; }
.internal-login button[type='submit'] { padding: 12px 16px; border: 0; border-radius: 8px; background: var(--jade, #3156c8); color: #fff; font-weight: 700; cursor: pointer; }
.internal-login button:disabled { cursor: wait; opacity: .62; }
.internal-login-error { margin: 0; color: #a43d36; font-size: 13px; }
.registration-success { display: grid; gap: 8px; margin-top: 18px; padding: 14px; border-radius: 10px; background: rgba(49, 86, 200, .1); color: var(--ink-soft, #56636f); }
.registration-success strong { color: var(--jade, #3156c8); }
.registration-success code { width: fit-content; padding: 5px 8px; border-radius: 5px; background: rgba(23, 37, 53, .08); color: var(--ink, #172535); font: 700 15px/1.2 var(--mono, monospace); letter-spacing: .08em; }
.registration-success button { justify-self: start; margin-top: 3px; padding: 8px 12px; border: 0; border-radius: 7px; background: var(--jade, #3156c8); color: #fff; cursor: pointer; }
.mode-switch { margin-top: 16px; border: 0; background: transparent; color: var(--jade, #3156c8); cursor: pointer; font: inherit; }
.internal-login small { display: block; margin-top: 22px; color: var(--ink-faint, #8a959b); line-height: 1.6; }
</style>
