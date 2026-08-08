export interface GeneratedSecret {
  secret: string;
  digest: string;
}

/**
 * Gera segredos de alta entropia (código de autorização, credenciais de
 * acesso/renovação, identificador de pedido de autorização) e calcula o
 * digest usado para persistência (E10). O segredo em claro nunca é
 * armazenado — apenas retornado uma vez, no momento da emissão.
 */
export interface DelegatedSecretService {
  generate(): GeneratedSecret;
  digest(secret: string): string;
}
