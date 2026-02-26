# minicoder

[![Certified Shovelware](https://justin.searls.co/img/shovelware.svg)](https://justin.searls.co/shovelware/)

*This is vibecoded software in alpha status, so use with caution. The file format is not guaranteed to be stable and (unannounced) upgrades may involve manual search-and-replace regex work. Make regular backups of your data. You use Git, right? Right?*

Simple in-browser qualitative data analysis tool for plain-text files, which stores your data in plain-text human-decipherable JSON files on your local disk. Only works in [browsers (currently only Chromium and derivatives)](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker#browser_compatibility) that have the ability to open a writable folder on your local file system.

## Design principles

- minicoder ❤️ plain text. minicoder supports coding in plain-text files and stores its data in plain-text files. Extracting text from other file formats is fully out of scope: there are plenty of applications to do that before you start analysis. If you need to analyse audio, video or other non-text content, minicoder is not for you.
- minicoder ❤️ Git. Because we only deal with plain text files, Git is the perfect tool to make backups, keep track of changes in your data and analysis and collaborate asynchronously. You technically don't have to use Git, but you probably should.
- minicoder ❤️ memory. minicoder runs fully in memory, loading all data in memory for lightning fast queries. But don't worry: since it's all just plaintext, memory usage won't come close to an idle Microsoft Teams tab. If you have a gigantic dataset, then minicoder might not be for you.
- minicoder ❤️ standards. While minicoder does not actually support the [REFI-QDA](https://www.qdasoftware.org/) standard at the moment, we carefully design our datamodel to be as aligned with the REFI model as possible, without compromising on other principles.
