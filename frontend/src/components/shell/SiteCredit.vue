<script setup lang="ts">
defineProps<{ placement?: 'hero' | 'doctor-rail' | 'patient-rail' }>()

const detail = '感谢“中国科学院深圳先进技术研究院 支撑平台处 网络信息管理中心”提供平台服务器、网络与运维，谨致谢忱。'
</script>

<template>
  <p
    v-if="placement === 'doctor-rail'"
    class="site-credit site-credit--doctor-rail"
    :title="`致谢。${detail}`"
  >
    致谢<br />中科院深圳先进院<br />网络信息管理中心
  </p>
  <p v-else class="site-credit" :class="placement === 'patient-rail' ? 'site-credit--patient-rail' : 'site-credit--hero'" :title="detail">
    感谢“<strong>中国科学院深圳先进技术研究院 支撑平台处 网络信息管理中心</strong>”提供平台服务器、网络与运维，谨致谢忱。
  </p>
</template>