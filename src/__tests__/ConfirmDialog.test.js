import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from '../components/common/ConfirmDialog.vue';

const mountDialog = () => mount(ConfirmDialog, {
  props: { show: true },
  global: {
    stubs: {
      Teleport: true,
      Transition: false,
    },
  },
});

describe('ConfirmDialog', () => {
  it('emits confirm when the confirm button is clicked', async () => {
    const wrapper = mountDialog();

    await wrapper.findAll('button')[1].trigger('click');

    expect(wrapper.emitted('confirm')).toHaveLength(1);
  });

  it('emits cancel when the cancel button is clicked', async () => {
    const wrapper = mountDialog();

    await wrapper.findAll('button')[0].trigger('click');

    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
