import { defineStore } from 'pinia'

// 取水泵组排布的查询条件与页码在会话内保持：翻页、切走再切回都不退回未挑过的全集。
type IntakeState = {
  pumpNo: string
  plant: string
  page: number
  locateNo: string
}

export const useIntakeStore = defineStore('intakepump-query', {
  state: (): IntakeState => ({
    pumpNo: '',
    plant: '',
    page: 1,
    locateNo: '',
  }),
  actions: {
    setFilters(pumpNo: string, plant: string) {
      this.pumpNo = pumpNo
      this.plant = plant
      this.page = 1
    },
    setPage(page: number) {
      this.page = page
    },
    setLocate(pumpNo: string) {
      this.locateNo = pumpNo
    },
    reset() {
      this.pumpNo = ''
      this.plant = ''
      this.page = 1
      this.locateNo = ''
    },
  },
})
