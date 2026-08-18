<script setup lang="ts">
defineProps<{ placement?: 'doctor-rail' | 'patient-rail' }>()

const detail = '循医平台的开发与持续运行，得到了中国科学院深圳先进技术研究院支撑平台处网络信息管理中心在服务器、网络与运维方面的大力支持与专业保障，谨此致以诚挚谢意。'
</script>

<template>
  <p v-if="placement === 'doctor-rail'" class="site-credit site-credit--doctor-rail" title="致谢。{{ detail }}">
    致谢<br />中科院深圳先进院<br />网络信息管理中心
  </p>
  <p v-else class="site-credit site-credit--patient-rail" :title="detail">
    致谢。平台的服务器、网络与运维，由中国科学院深圳先进技术研究院 支撑平台处 网络信息管理中心 持续保障，谨致谢忱。
  </p>
</template>