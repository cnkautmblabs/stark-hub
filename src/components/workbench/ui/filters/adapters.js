// Adaptadores pro formato canonico de opcao ({value, label, ...}) que
// FilterField/FilterCombobox esperam — cobrem os dois formatos nao-
// canonicos que ja existem no app hoje, sem precisar pre-transformar o
// dado em cada tela que migra pro componente novo.

// Testes/EvidenceComponents.jsx usa tuplas [key, texto] em vez de objetos.
export function optionsFromTuples(tuples = []) {
  return tuples.map(([value, label]) => ({ value, label }));
}

// Varias telas hoje passam listas de string solta (codigo de pais, tag,
// ambiente em maiusculo) contando com o getOptionValue/getOptionLabel
// padrao do FilterCombobox — aqui vira objeto explicito pra manter o
// mesmo formato em qualquer variant/mode do FilterField.
export function optionsFromStrings(list = []) {
  return list.map((value) => ({ value, label: String(value) }));
}
