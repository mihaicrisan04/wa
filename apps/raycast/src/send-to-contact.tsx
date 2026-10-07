import { Action, ActionPanel, Icon, List, getPreferenceValues } from "@raycast/api";
import { useEffect, useState, useCallback } from "react";
import { sendClipboardTo } from "./lib/send-clipboard";

interface Preferences {
  phoneNumber: string;
  daemonPort: string;
}

interface Contact {
  jid: string;
  name: string | null;
  pushName: string | null;
  verifiedName: string | null;
  phone: string;
  lastMessageTs: number;
}

export default function Command() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const prefs = getPreferenceValues<Preferences>();
  const port = parseInt(prefs.daemonPort) || 7272;

  const fetchContacts = useCallback(
    async (query: string) => {
      setIsLoading(true);
      try {
        const res = await fetch(`http://localhost:${port}/contacts?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          setContacts((await res.json()) as Contact[]);
        }
      } catch {
        // daemon not reachable
      }
      setIsLoading(false);
    },
    [port],
  );

  useEffect(() => {
    fetchContacts(searchText);
  }, [searchText, fetchContacts]);

  async function handleSend(contact: Contact) {
    const displayName = contact.name || contact.pushName || contact.phone;
    await sendClipboardTo(port, contact.phone, displayName);
  }

  function displayName(c: Contact): string {
    return c.name || c.pushName || c.verifiedName || c.phone;
  }

  function subtitle(c: Contact): string {
    const parts: string[] = [];
    if (c.name && c.pushName && c.name !== c.pushName) parts.push(`~${c.pushName}`);
    parts.push(`+${c.phone}`);
    return parts.join("  ");
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search contacts..."
      onSearchTextChange={setSearchText}
      throttle
    >
      {contacts.map((contact) => (
        <List.Item
          key={contact.jid}
          icon={Icon.Person}
          title={displayName(contact)}
          subtitle={subtitle(contact)}
          accessories={contact.verifiedName ? [{ tag: "business" }] : []}
          actions={
            <ActionPanel>
              <Action
                title="Send Clipboard"
                icon={Icon.Message}
                onAction={() => handleSend(contact)}
              />
            </ActionPanel>
          }
        />
      ))}
      {!isLoading && contacts.length === 0 && searchText && (
        <List.EmptyView title="No contacts found" description={`No match for "${searchText}"`} />
      )}
      {!isLoading && contacts.length === 0 && !searchText && (
        <List.EmptyView
          title="No contacts synced yet"
          description="Contacts load after the daemon connects. Try again in a moment."
        />
      )}
    </List>
  );
}
