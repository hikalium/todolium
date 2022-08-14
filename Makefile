.PHONY : backup run

run:
	tsc
	npm start

backup:
	mkdir -p backup
	cp todo.json backup/todo_backup_`date +%Y%m%d_%H%M%S`.json
	ls -la backup
