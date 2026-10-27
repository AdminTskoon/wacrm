'use client';

import { useEffect, useState } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AiKnowledgeCard } from '@/components/settings/ai-knowledge';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

export default function AgentsPage() {
  const t = useTranslations('Settings.aiConfig');
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const [hasEmbeddingsKey, setHasEmbeddingsKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiConfig, setAiConfig] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setHasEmbeddingsKey(Boolean(data?.has_embeddings_key));
          if (data?.configured) {
            setAiConfig(data);
          }
        }
      } catch {
        // Ignorer l'erreur
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      if (aiConfig?.configured) {
        const res = await fetch('/api/ai/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: aiConfig.provider,
            model: aiConfig.model,
            system_prompt: aiConfig.system_prompt,
            is_active: aiConfig.is_active,
            auto_reply_enabled: aiConfig.auto_reply_enabled,
            auto_reply_max_per_conversation: aiConfig.auto_reply_max_per_conversation,
            handoff_agent_id: aiConfig.handoff_agent_id,
          }),
        });
        if (res.ok) {
          toast.success(t('saveSuccess'));
        } else {
          toast.error(t('saveFailed'));
        }
      } else {
        toast.success(t('saveSuccess'));
      }
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            AI Agents
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Gérez votre base de connaissances pour l'agent IA.
        </p>
      </div>

      <AiKnowledgeCard
        accountId={accountId}
        canEdit={canEdit}
        hasEmbeddingsKey={hasEmbeddingsKey}
      />

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={!canEdit || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
