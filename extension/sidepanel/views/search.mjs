// Onglet Recherche : monté depuis le module de recherche autonome.
import { createSearchPanel } from '../../search/panel.mjs';
import { S } from '../state.mjs';
import { $, esc, tr, toast, fmtDate } from '../ui.mjs';
import { api } from '../api.mjs';
import { activateApplication } from './application.mjs';
import { renderActionBar } from './actionbar.mjs';

// « Arrêter la recherche » vit dans la barre d’action collante, quel que soit l’onglet.
export const searchPanel = createSearchPanel({ element: $('#tab-search'), onRunChange: () => renderActionBar(), api, tr, esc, fmtDate, toast,
  canStart: () => !S.fillBusy,
  activateApplication,
});
