<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { PatientProfile, PatientSex, PregnancyStatus } from '../../types/domain'

const props = defineProps<{ open: boolean; profiles: PatientProfile[]; selectedId?: string | null }>()
const emit = defineEmits<{
  close: []
  select: [profileId: string]
  save: [profile: Omit<PatientProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }]
}>()

const editing = ref(false)
const form = reactive<{ id?: string; name: string; sex: PatientSex; age: string; allergies: string; pregnancy: PregnancyStatus; memory: string }>({
  name: '', sex: 'unspecified', age: '', allergies: '', pregnancy: 'not_applicable', memory: '',
})

const clearForm = () => Object.assign(form, { id: undefined, name: '', sex: 'unspecified', age: '', allergies: '', pregnancy: 'not_applicable', memory: '' })
watch(() => props.open, (open) => {
  if (!open) return
  editing.value = !props.profiles.length
  if (editing.value) clearForm()
})
const edit = (profile?: PatientProfile) => {
  if (profile) Object.assign(form, { ...profile, age: profile.age === undefined ? '' : String(profile.age) })
  else clearForm()
  editing.value = true
}
const save = () => {
  if (!form.name.trim()) return
  const age = form.age === '' ? undefined : Number(form.age)
  if (age !== undefined && (!Number.isInteger(age) || age < 0 || age > 120)) return
  emit('save', {
    ...(form.id ? { id: form.id } : {}), name: form.name.trim(), sex: form.sex,
    ...(age === undefined ? {} : { age }),
    allergies: form.allergies.trim(), pregnancy: form.pregnancy, memory: form.memory.trim(),
  })
  editing.value = false
}
</script>

<template>
  <div v-if="open" class="profile-dialog-backdrop" @click.self="emit('close')">
    <section class="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
      <header>
        <div><small>避免家人之间的信息混在一起</small><h2 id="profile-dialog-title">这次是在为谁准备？</h2></div>
        <button type="button" aria-label="关闭档案选择" @click="emit('close')">×</button>
      </header>
      <form v-if="editing" class="profile-form" @submit.prevent="save">
        <label><span>怎么称呼</span><input v-model="form.name" required maxlength="40" placeholder="例如：我、妈妈、小明" /></label>
        <div class="profile-form-row">
          <label><span>性别</span><select v-model="form.sex"><option value="unspecified">暂不说明</option><option value="female">女</option><option value="male">男</option></select></label>
          <label><span>年龄</span><input v-model="form.age" type="number" min="0" max="120" placeholder="岁" /></label>
          <label><span>孕期情况</span><select v-model="form.pregnancy"><option value="not_applicable">不适用</option><option value="no">非孕期</option><option value="yes">孕期</option><option value="unsure">不确定</option></select></label>
        </div>
        <label><span>过敏史</span><input v-model="form.allergies" maxlength="500" placeholder="没有可写“无”；不清楚可留空" /></label>
        <label><span>长期备注</span><textarea v-model="form.memory" maxlength="2000" placeholder="只记录你确认过、以后就诊也有帮助的特点，例如长期用药、沟通偏好。" /></label>
        <p>对话里的推测不会自动写进档案；长期备注始终由你确认和修改。</p>
        <footer><button type="button" @click="editing = false">返回</button><button class="primary" type="submit">保存档案</button></footer>
      </form>
      <template v-else>
        <div class="profile-card-list">
          <article v-for="profile in profiles" :key="profile.id" class="profile-card" :class="{ selected: profile.id === selectedId }">
            <button class="profile-card-main" type="button" @click="emit('select', profile.id)">
              <span class="profile-avatar">{{ profile.name.slice(0, 1) }}</span>
              <span><strong>{{ profile.name }}</strong><small>{{ profile.sex === 'female' ? '女' : profile.sex === 'male' ? '男' : '性别未说明' }}{{ profile.age === undefined ? '' : ` · ${profile.age} 岁` }} · {{ profile.allergies || '过敏史未说明' }}</small></span>
              <em>{{ profile.id === selectedId ? '当前档案' : '选择' }}</em>
            </button>
            <button class="profile-edit" type="button" @click="edit(profile)">编辑</button>
          </article>
        </div>
        <button class="profile-new" type="button" @click="edit()">＋ 新建家人档案</button>
      </template>
    </section>
  </div>
</template>
