import React, { useState } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { generateId } from '../lib/calculations';
import type { CustomField, CustomFieldType, ModelType, TradingModel } from '../types/journal';

interface ModelsScreenProps {
  models: TradingModel[];
  fields: CustomField[];
  onSaveModel: (model: TradingModel) => Promise<void> | void;
  onDeleteModel: (id: string) => Promise<void> | void;
  onSaveField: (field: CustomField) => Promise<void> | void;
  onDeleteField: (id: string) => Promise<void> | void;
}

export const ModelsScreen: React.FC<ModelsScreenProps> = React.memo(({
  models,
  fields,
  onSaveModel,
  onDeleteModel,
  onSaveField,
  onDeleteField,
}) => {
  // Model Modal State
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelName, setModelName] = useState('');
  const [modelType, setModelType] = useState<ModelType>('Reversal');
  const [modelEntry, setModelEntry] = useState('');
  const [modelRisk, setModelRisk] = useState('');

  // Custom Field Modal State
  const [fieldModalOpen, setFieldModalOpen] = useState(false);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldHint, setFieldHint] = useState('');
  const [fieldOptions, setFieldOptions] = useState('');

  const openModelModal = (m?: TradingModel) => {
    if (m) {
      setEditingModelId(m.id);
      setModelName(m.name);
      setModelType(m.type);
      setModelEntry(m.entry);
      setModelRisk(m.risk);
    } else {
      setEditingModelId(null);
      setModelName('');
      setModelType('Reversal');
      setModelEntry('');
      setModelRisk('');
    }
    setModelModalOpen(true);
  };

  const openFieldModal = (f?: CustomField) => {
    if (f) {
      setEditingFieldId(f.id);
      setFieldName(f.name);
      setFieldType(f.type);
      setFieldRequired(f.required);
      setFieldHint(f.hint);
      setFieldOptions(f.options.join(', '));
    } else {
      setEditingFieldId(null);
      setFieldName('');
      setFieldType('text');
      setFieldRequired(false);
      setFieldHint('');
      setFieldOptions('');
    }
    setFieldModalOpen(true);
  };

  const handleModelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim()) return;
    await onSaveModel({
      id: editingModelId || generateId(),
      name: modelName.trim(),
      type: modelType,
      entry: modelEntry.trim(),
      risk: modelRisk.trim(),
    });
    setModelModalOpen(false);
  };

  const handleFieldSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fieldName.trim()) return;
    const parsedOptions = fieldOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    await onSaveField({
      id: editingFieldId || generateId(),
      name: fieldName.trim(),
      type: fieldType,
      required: fieldRequired,
      hint: fieldHint.trim(),
      options: parsedOptions,
    });
    setFieldModalOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-[#8df0c0]">
            Your rules, your way
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-extrabold text-[#eef3fb]">
            Models & custom fields
          </h2>
          <p className="mt-1 text-sm text-[#8b9ab0]">
            Document execution models and customize the exact properties captured in every trade.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openModelModal()}
          className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#47dca0] px-4 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0] transition whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4 stroke-[2.5]" />
          <span>New model</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* My Models */}
        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                Execution frameworks
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">My models</h3>
            </div>
            <button
              type="button"
              onClick={() => openModelModal()}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3 py-1.5 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <Plus className="w-3.5 h-3.5 text-[#8df0c0]" />
              <span>Add model</span>
            </button>
          </div>

          {models.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm font-medium text-[#9aa8be]">
                Create a model to document your rules.
              </p>
              <p className="text-xs text-[#70819b]">
                Models appear as quick-pick options when logging trades.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {models.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl glass-subcard p-4 space-y-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-bold text-sm text-[#eef3fb]">{m.name}</h4>
                      <p className="text-xs text-[#8df0c0] mt-0.5">{m.type}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openModelModal(m)}
                        aria-label={`Edit ${m.name}`}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#202c40] text-[#9aa8be] hover:text-[#eef3fb] hover:border-[#344869] transition"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteModel(m.id)}
                        aria-label={`Delete ${m.name}`}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#202c40] text-[#ff7d91] hover:bg-[#ff7d91]/10 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-[#9aa8be] space-y-1 pt-1">
                    <p>
                      <span className="font-semibold text-[#c7d3e5]">Entry:</span>{' '}
                      {m.entry || '—'}
                    </p>
                    <p>
                      <span className="font-semibold text-[#c7d3e5]">Risk & targets:</span>{' '}
                      {m.risk || '—'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        {/* Custom Properties */}
        <article className="rounded-2xl glass-card p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <p className="text-xs font-medium text-[#8df0c0]">
                Journal builder
              </p>
              <h3 className="text-base font-bold text-[#eef3fb]">Custom properties</h3>
            </div>
            <button
              type="button"
              onClick={() => openFieldModal()}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-[#111c2d] border border-[#23344f] px-3 py-1.5 text-xs font-semibold text-[#eef3fb] hover:border-[#47dca0]/45 transition"
            >
              <Plus className="w-3.5 h-3.5 text-[#8df0c0]" />
              <span>Add field</span>
            </button>
          </div>

          <p className="text-xs text-[#8b9ab0]">
            Create custom fields like liquidity sweep, entry model, or displacement. Fields appear automatically in the Log Trade form. Existing values remain attached to past trades.
          </p>

          {fields.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#8b9ab0]">No custom properties yet.</div>
          ) : (
            <div className="space-y-2.5">
              {fields.map((f) => {
                const typeLabel =
                  f.type === 'both' ? 'Text + number' : f.type === 'number' ? 'Number' : 'Text';
                return (
                  <div
                    key={f.id}
                    className="rounded-xl glass-subcard px-4 py-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#eef3fb] truncate">
                        {f.name}
                        {f.required && (
                          <span className="ml-2 text-xs font-semibold text-[#8df0c0]">
                            Required
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-[#7f8fa8] truncate">
                        {typeLabel}
                        {f.options.length > 0 ? ` · ${f.options.join(', ')}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openFieldModal(f)}
                        aria-label={`Edit ${f.name}`}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#202c40] text-[#9aa8be] hover:text-[#eef3fb]"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteField(f.id)}
                        aria-label={`Delete ${f.name}`}
                        className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-[#202c40] text-[#ff7d91] hover:bg-[#ff7d91]/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>

      {/* Model Modal */}
      {modelModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md sm:p-4"
          onClick={() => setModelModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl glass-modal p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
              <div>
                <p className="text-xs font-medium text-[#8df0c0]">
                  Model builder
                </p>
                <h3 className="text-lg font-bold text-[#eef3fb]">
                  {editingModelId ? 'Edit model' : 'New model'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModelModalOpen(false)}
                aria-label="Close modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleModelSubmit} className="mt-4 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[#a9b7cc]">Name</span>
                  <input
                    type="text"
                    required
                    value={modelName}
                    onChange={(e) => setModelName(e.target.value)}
                    placeholder="London liquidity reversal"
                    className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[#a9b7cc]">Type</span>
                  <select
                    value={modelType}
                    onChange={(e) => setModelType(e.target.value as ModelType)}
                    className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                  >
                    <option value="Reversal">Reversal</option>
                    <option value="Continuation">Continuation</option>
                    <option value="Both">Both</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Entry conditions</span>
                <textarea
                  rows={3}
                  value={modelEntry}
                  onChange={(e) => setModelEntry(e.target.value)}
                  placeholder="Sweep, displacement, MSS, retracement…"
                  className="w-full rounded-xl glass-input px-3 py-2.5 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Risk & targets</span>
                <textarea
                  rows={3}
                  value={modelRisk}
                  onChange={(e) => setModelRisk(e.target.value)}
                  placeholder="Invalidation and next meaningful liquidity."
                  className="w-full rounded-xl glass-input px-3 py-2.5 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setModelModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-[#223047] bg-[#111a2d] px-4 py-2 text-sm font-semibold text-[#eef3fb]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0]"
                >
                  Save model
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Field Modal */}
      {fieldModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-md sm:p-4"
          onClick={() => setFieldModalOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl glass-modal p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
              <div>
                <p className="text-xs font-medium text-[#8df0c0]">
                  Property designer
                </p>
                <h3 className="text-lg font-bold text-[#eef3fb]">
                  {editingFieldId ? 'Edit property' : 'Create property'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFieldModalOpen(false)}
                aria-label="Close modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-[#8b9ab0] hover:text-[#eef3fb]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFieldSubmit} className="mt-4 space-y-3.5">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Property name</span>
                <input
                  type="text"
                  required
                  value={fieldName}
                  onChange={(e) => setFieldName(e.target.value)}
                  placeholder="Liquidity sweep"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[#a9b7cc]">Input type</span>
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                    className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="both">Text + number</option>
                  </select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[#a9b7cc]">Requirement</span>
                  <select
                    value={fieldRequired ? 'yes' : 'no'}
                    onChange={(e) => setFieldRequired(e.target.value === 'yes')}
                    className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                  >
                    <option value="no">Optional</option>
                    <option value="yes">Required</option>
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">Hint / example</span>
                <input
                  type="text"
                  value={fieldHint}
                  onChange={(e) => setFieldHint(e.target.value)}
                  placeholder="e.g. PDL, PDH, BSL, SSL"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#a9b7cc]">
                  Options (comma-separated, optional)
                </span>
                <input
                  type="text"
                  value={fieldOptions}
                  onChange={(e) => setFieldOptions(e.target.value)}
                  placeholder="PDH, PDL, BSL, SSL"
                  className="w-full min-h-[44px] rounded-xl glass-input px-3 py-2 text-sm text-[#eef3fb] focus:border-[#47dca0] focus:outline-none"
                />
              </label>

              <div className="pt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setFieldModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-[#223047] bg-[#111a2d] px-4 py-2 text-sm font-semibold text-[#eef3fb]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-[#47dca0] px-5 py-2 text-sm font-bold text-[#051612] hover:bg-[#62e4b0]"
                >
                  Save property
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
});

ModelsScreen.displayName = 'ModelsScreen';
